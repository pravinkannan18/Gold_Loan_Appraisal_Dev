import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, ArrowRight, Shield, CheckCircle, Sparkles, FileImage, Zap, MapPin, Globe, AlertCircle, Loader2 } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { showToast } from '../lib/utils';
import { AuroraLayout } from '../components/layouts/AuroraLayout';

interface JewelleryItemCapture {
  itemNumber: number;
  image: string;
}

interface OverallImageCapture {
  id: number;
  image: string;
  timestamp: string;
}

const stageToStepKey: Record<string, number> = {
  appraiser: 1,
  customer: 2,
  rbi: 3,
  purity: 4,
  summary: 5,
};


export function RBICompliance() {
  const navigate = useNavigate();
  const location = useLocation();
  const cameraRef = useRef<LiveCameraHandle>(null);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [overallImages, setOverallImages] = useState<OverallImageCapture[]>([]);
  const [capturedItems, setCapturedItems] = useState<JewelleryItemCapture[]>([]);
  const [currentCapturingItem, setCurrentCapturingItem] = useState<number | null>(null);
  const [captureMode, setCaptureMode] = useState<'overall' | 'individual' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;
  // Initialize selectedCameraId from localStorage saved setting
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    const savedDeviceId = localStorage.getItem('camera_rbi-compliance');
    if (savedDeviceId) {
      console.log('📹 Loaded saved camera for rbi-compliance:', savedDeviceId);
    }
    return savedDeviceId || '';
  });

  const [gpsData, setGpsData] = useState<{
    latitude: number;
    longitude: number;
    source: string;
    address: string;
    timestamp: string;
    map_image?: string;
  } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const fetchGPS = useCallback(async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/gps/location`, {
        credentials: 'include', // if you use auth
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGpsData(data);
    } catch (err: any) {
      console.error('GPS fetch error:', err);
      setGpsError(err.message || 'Failed to get location');
    } finally {
      setGpsLoading(false);
    }
  }, []);
  useEffect(() => {
    // Check if appraiser data exists
    const appraiserData = localStorage.getItem('currentAppraiser');
    const frontImage = localStorage.getItem('customerFrontImage');

    console.log('RBICompliance - checking prerequisites');
    console.log('Appraiser data:', appraiserData ? 'exists' : 'missing');
    console.log('Front image:', frontImage ? 'exists' : 'missing');

    if (!appraiserData) {
      showToast('Please complete appraiser details first', 'error');
      navigate('/appraiser-details');
      return;
    }

    // Relaxed check: We no longer check for localStorage image since we use DB session
    // We assume if they have session_id (checked elsewhere or implied), they are good.
    // Ideally we should check session status from API, but for now we trust the flow.
    const sessionId = localStorage.getItem('appraisal_session_id');
    if (!sessionId) {
      showToast('Session not active. Starting over.', 'error');
      navigate('/appraiser-details');
      return;
    }

    fetchGPS();
  }, [navigate, fetchGPS]);

  const handleConfirmItems = () => {
    if (totalItems < 1 || totalItems > 50) {
      showToast('Please enter a valid number of items (1-50)', 'error');
      return;
    }
    showToast(`Ready to capture jewellery for ${totalItems} items`, 'info');
  };

  const handleOpenOverallCamera = () => {
    setCaptureMode('overall');
    cameraRef.current?.openCamera();
  };

  const handleCaptureOverallImage = () => {
    const imageData = cameraRef.current?.captureImage();
    if (imageData) {
      const newOverallImage: OverallImageCapture = {
        id: overallImages.length + 1,
        image: imageData,
        timestamp: new Date().toISOString(),
      };
      setOverallImages(prev => [...prev, newOverallImage]);
      cameraRef.current?.closeCamera();
      setCaptureMode(null);
      showToast(`Overall image ${overallImages.length + 1} captured!`, 'success');
    }
  };

  const handleRemoveOverallImage = (id: number) => {
    setOverallImages(prev => prev.filter(img => img.id !== id));
    showToast('Overall image removed', 'info');
  };

  const handleOpenIndividualCamera = () => {
    // Find the next uncaptured item
    const nextItem = Array.from({ length: totalItems }, (_, i) => i + 1)
      .find(num => !getItemImage(num));

    if (nextItem) {
      setCurrentCapturingItem(nextItem);
      setCaptureMode('individual');
      cameraRef.current?.openCamera();
    } else {
      showToast('All items have been captured', 'info');
    }
  };

  const handleOpenItemCamera = (itemNumber: number) => {
    setCurrentCapturingItem(itemNumber);
    setCaptureMode('individual');
    cameraRef.current?.openCamera();
  };

  const handleCaptureItem = () => {
    if (currentCapturingItem === null) return;

    const imageData = cameraRef.current?.captureImage();
    if (imageData) {
      setCapturedItems((prev) => {
        const filtered = prev.filter((item) => item.itemNumber !== currentCapturingItem);
        return [...filtered, { itemNumber: currentCapturingItem, image: imageData }];
      });
      cameraRef.current?.closeCamera();
      setCurrentCapturingItem(null);
      setCaptureMode(null);
      showToast(`Item ${currentCapturingItem} captured!`, 'success');
    }
  };

  const getItemImage = (itemNumber: number): string | undefined => {
    return capturedItems.find((item) => item.itemNumber === itemNumber)?.image;
  };

  const allItemsCaptured = totalItems > 0 && capturedItems.length === totalItems;

  // Determine if user can proceed - either complete overall OR complete individual
  const canProceed = () => {
    if (totalItems === 0) return false;

    const hasCompleteOverall = overallImages.length > 0;
    const hasCompleteIndividual = capturedItems.length === totalItems;
    const hasPartialIndividual = capturedItems.length > 0 && capturedItems.length < totalItems;

    // Can proceed if:
    // 1. Has overall images (any amount), OR
    // 2. Has completed ALL individual items
    // Cannot proceed if has partial individual (forces completion)
    return hasCompleteOverall || hasCompleteIndividual;
  };

  const getNextButtonStatus = () => {
    if (totalItems === 0) {
      return {
        disabled: true,
        text: 'Next Step',
        title: 'Please enter the number of jewellery first'
      };
    }

    const hasOverall = overallImages.length > 0;
    const hasPartialIndividual = capturedItems.length > 0 && capturedItems.length < totalItems;
    const hasCompleteIndividual = capturedItems.length === totalItems;

    if (hasOverall) {
      return {
        disabled: false,
        text: 'Next Step',
        title: 'Proceed to next step (using overall images)'
      };
    }

    if (hasCompleteIndividual) {
      return {
        disabled: false,
        text: 'Next Step',
        title: 'Proceed to next step (all individual items captured)'
      };
    }

    if (hasPartialIndividual) {
      return {
        disabled: true,
        text: `Next (${capturedItems.length}/${totalItems})`,
        title: `Complete all individual items or capture overall images (${capturedItems.length}/${totalItems} items captured)`
      };
    }

    return {
      disabled: true,
      text: 'Next Step',
      title: 'Capture overall images or complete all individual item images'
    };
  };

  const handleNext = async () => {
    console.log('=== RBI COMPLIANCE - HANDLE NEXT CLICKED ===');
    console.log('Current state:', {
      totalItems,
      overallImagesCount: overallImages.length,
      capturedItemsCount: capturedItems.length,
      overallImages: overallImages,
      capturedItems: capturedItems
    });

    if (totalItems === 0) {
      console.log('Error: No total items specified');
      showToast('Please enter the number of jewellery', 'error');
      return;
    }

    // Check if we have any images at all
    if (overallImages.length === 0 && capturedItems.length === 0) {
      showToast('Please capture at least one overall image or complete all individual item images', 'error');
      return;
    }

    // If user started individual capture, they must complete ALL items
    if (capturedItems.length > 0 && capturedItems.length < totalItems) {
      const missingItems = [];
      for (let i = 1; i <= totalItems; i++) {
        if (!capturedItems.find(item => item.itemNumber === i)) {
          missingItems.push(i);
        }
      }
      showToast(
        `Individual capture incomplete. Please capture all items or use overall images. Missing: Item ${missingItems.join(', Item ')}`,
        'error'
      );
      return;
    }

    // Allow proceeding if:
    // 1. Has overall images (regardless of individual count), OR
    // 2. Has completed ALL individual items (capturedItems.length === totalItems)
    const hasCompleteOverall = overallImages.length > 0;
    const hasCompleteIndividual = capturedItems.length === totalItems;

    if (!hasCompleteOverall && !hasCompleteIndividual) {
      showToast('Please complete either overall images or capture all individual item images', 'error');
      return;
    }

    setIsLoading(true);

    try {
      // Get session ID from localStorage
      const sessionId = localStorage.getItem('appraisal_session_id');
      console.log('Session ID:', sessionId);

      if (!sessionId) {
        showToast('Session not found. Please start from appraiser details.', 'error');
        navigate('/appraiser-details');
        return;
      }

      console.log('=== SAVING RBI COMPLIANCE DATA TO DATABASE ===');
      console.log('Overall images count:', overallImages.length);
      console.log('Total items:', totalItems);
      console.log('Captured items:', capturedItems.length);
      console.log('Validation - hasCompleteOverall:', hasCompleteOverall);
      console.log('Validation - hasCompleteIndividual:', hasCompleteIndividual);

      // Prepare data for API
      const rbiData = {
        overall_images: overallImages.map(img => ({
          id: img.id,
          image: img.image,
          timestamp: img.timestamp
        })),
        captured_items: capturedItems.map(item => ({
          itemNumber: item.itemNumber,
          image: item.image,
          description: `Item ${item.itemNumber}`
        })),
        total_items: totalItems,
        capture_method: capturedItems.length === totalItems ? 'individual' : 'overall'
      };

      // Save to database via API
      console.log('Sending RBI compliance data to API...');
      const saveResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/rbi-compliance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rbiData)
      });

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save RBI compliance data');
      }

      const result = await saveResponse.json();
      console.log('RBI compliance saved to database:', result);

      // Store only minimal data in localStorage for quick access
      localStorage.setItem('totalItems', totalItems.toString());

      showToast('RBI compliance data saved!', 'success');
      console.log('=== NAVIGATING TO PURITY TESTING ===');
      navigate('/purity-testing');
    } catch (error: any) {
      console.error('=== ERROR SAVING RBI COMPLIANCE ===');
      console.error('Error message:', error?.message);
      console.error('Full error:', error);
      showToast(`Failed to save RBI compliance data: ${error?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Premium Animated Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(48,50%,99%)] via-[hsl(158,30%,97%)] to-[hsl(320,100%,98%)] dark:from-[hsl(158,30%,8%)] dark:via-[hsl(158,25%,10%)] dark:to-[hsl(320,50%,10%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,_rgba(9,84,61,0.08),_transparent_50%),_radial-gradient(circle_at_70%_70%,_rgba(255,169,233,0.1),_transparent_50%),_radial-gradient(circle_at_50%_10%,_rgba(9,84,61,0.05),_transparent_40%)] animate-pulse" style={{ animationDuration: '8s' }} />
      <div className="absolute inset-0 backdrop-blur-3xl bg-white/40 dark:bg-[hsl(158,30%,8%)]/40" />

      {/* Premium Floating Orbs */}
      <div className="absolute top-20 left-10 w-72 h-72 bg-[hsl(158,82%,18%,0.12)] dark:bg-[hsl(158,82%,18%,0.08)] rounded-full blur-3xl animate-pulse" style={{ animationDuration: '6s' }} />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-[hsl(320,100%,83%,0.15)] dark:bg-[hsl(320,100%,83%,0.08)] rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s', animationDelay: '2s' }} />

      <div className="relative z-10">
        <StepIndicator currentStep={3} />

        {/* Full Width Premium Layout */}
        <div className="min-h-[calc(100vh-120px)]">
          <div className="h-full bg-gradient-to-br from-white/95 via-white/90 to-[hsl(48,50%,97%)]/80 backdrop-blur-2xl dark:from-[hsl(158,30%,10%)]/95 dark:via-[hsl(158,25%,12%)]/90 dark:to-[hsl(158,30%,10%)]/80">

            {/* Premium Header with Gradient Overlay - Full Width */}
            <div className="relative overflow-hidden bg-gradient-to-br from-[hsl(158,82%,18%)] via-[hsl(158,75%,22%)] to-[hsl(158,70%,25%)] px-8 py-8">
              {/* Animated Background Pattern */}
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNnptMCAwYzMuMzE0IDAgNiAyLjY4NiA2IDZzLTIuNjg2IDYtNiA2LTYtMi42ODYtNi02IDIuNjg2LTYgNi02eiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMSIvPjwvZz48L3N2Zz4=')] opacity-20" />
              <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-white/10 to-transparent rounded-full blur-3xl" />

              <div className="container mx-auto max-w-7xl">
                <div className="relative flex flex-wrap items-center gap-4">
                  <div className="group/icon relative">
                    <div className="absolute inset-0 bg-white/30 rounded-2xl blur-xl" />
                    <div className="relative rounded-2xl bg-white/20 p-3 shadow-2xl backdrop-blur-sm border border-white/30 transition-all duration-300 group-hover/icon:scale-110 group-hover/icon:bg-white/30">
                      <Shield className="h-8 w-8 text-white drop-shadow-lg" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="h-1 w-1 rounded-full bg-white/60 animate-pulse" />
                      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/90">RBI Compliance Documentation</p>
                    </div>
                    <h1 className="text-3xl font-bold text-white drop-shadow-2xl tracking-tight mb-1">Jewellery Image Capture</h1>
                    <div className="flex items-center gap-2 text-sm text-[hsl(158,60%,85%)]">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-0.5 backdrop-blur-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(320,100%,83%)] animate-pulse" />
                        Step 3 of 5
                      </span>
                      <span className="text-[hsl(158,50%,80%)]">— Regulatory compliance imaging</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Full Width Content */}
            <div className="container mx-auto max-w-7xl px-8 py-10">
              {/* Premium Items Count Section */}
              <div className="space-y-6 mb-10">
                <div className="group/input">
                  <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    Number of Jewellery Items <span className="text-red-500 text-base">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={totalItems || ''}
                      onChange={(e) => setTotalItems(parseInt(e.target.value) || 0)}
                      placeholder="Enter number of items (1-50)"
                      className="w-full rounded-xl border-2 border-slate-200/80 bg-white px-4 py-3 text-base font-medium text-slate-900 shadow-sm transition-all duration-300 placeholder:text-slate-400 hover:border-blue-300 focus:border-blue-500 focus:bg-white focus:shadow-lg focus:shadow-blue-500/10 focus:ring-4 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:hover:border-blue-500 dark:focus:bg-slate-800"
                    />
                    {totalItems > 0 && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-white">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <svg className="mt-0.5 h-3.5 w-3.5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <span>Specify the total count of jewellery pieces for RBI compliance documentation.</span>
                  </p>
                </div>
              </div>

              {/* Status Cards - Information Only */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
                {/* Overall Collection Card */}
                <div className="group/card relative overflow-hidden rounded-2xl border-2 border-blue-200/60 bg-gradient-to-br from-white via-blue-50/50 to-indigo-50/40 p-6 shadow-lg dark:border-blue-800/40 dark:from-slate-900/80 dark:via-blue-950/50 dark:to-indigo-950/40">
                  <div className="absolute top-0 right-0 h-32 w-32 bg-gradient-to-br from-blue-400/10 to-transparent rounded-full blur-2xl" />

                  <div className="relative flex items-start gap-4">
                    <div className="flex-shrink-0 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 p-3 shadow-lg ring-4 ring-blue-500/20">
                      <FileImage className="h-8 w-8 text-white" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">
                        Overall Collection
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                        Capture all jewellery items in one shot
                      </p>

                      <div className="flex items-center gap-3">
                        <div className="inline-flex items-center gap-2 rounded-lg bg-blue-100 px-3 py-1.5 dark:bg-blue-900/40">
                          <div className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                          <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                            {overallImages.length} {overallImages.length === 1 ? 'image' : 'images'}
                          </span>
                        </div>
                        {overallImages.length > 0 && (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Individual Items Card */}
                <div className={`group/card relative overflow-hidden rounded-2xl border-2 p-6 shadow-lg ${totalItems === 0
                  ? 'border-slate-200/60 bg-slate-50/50 opacity-60 dark:border-slate-800/40 dark:bg-slate-900/40'
                  : 'border-indigo-200/60 bg-gradient-to-br from-white via-indigo-50/50 to-violet-50/40 dark:border-indigo-800/40 dark:from-slate-900/80 dark:via-indigo-950/50 dark:to-violet-950/40'
                  }`}>
                  <div className={`absolute top-0 right-0 h-32 w-32 rounded-full blur-2xl ${totalItems === 0
                    ? 'bg-slate-400/5'
                    : 'bg-gradient-to-br from-indigo-400/10 to-transparent'
                    }`} />

                  <div className="relative flex items-start gap-4">
                    <div className={`flex-shrink-0 rounded-xl p-3 shadow-lg ${totalItems === 0
                      ? 'bg-slate-400 ring-4 ring-slate-400/20'
                      : 'bg-gradient-to-br from-indigo-500 to-violet-600 ring-4 ring-indigo-500/20'
                      }`}>
                      <Camera className="h-8 w-8 text-white" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className={`text-lg font-bold mb-1 ${totalItems === 0
                        ? 'text-slate-500 dark:text-slate-500'
                        : 'text-slate-900 dark:text-white'
                        }`}>
                        Individual Items
                      </h3>
                      <p className={`text-sm mb-3 ${totalItems === 0
                        ? 'text-slate-400'
                        : 'text-slate-600 dark:text-slate-400'
                        }`}>
                        {totalItems === 0 ? 'Set item count first' : 'Capture each item one by one'}
                      </p>

                      <div className="flex items-center gap-3">
                        <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ${totalItems === 0
                          ? 'bg-slate-100 dark:bg-slate-800'
                          : capturedItems.length === totalItems
                            ? 'bg-green-100 dark:bg-green-900/40'
                            : 'bg-indigo-100 dark:bg-indigo-900/40'
                          }`}>
                          <span className={`text-sm font-bold ${totalItems === 0
                            ? 'text-slate-500 dark:text-slate-500'
                            : capturedItems.length === totalItems
                              ? 'text-green-700 dark:text-green-300'
                              : 'text-indigo-700 dark:text-indigo-300'
                            }`}>
                            {capturedItems.length} / {totalItems}
                          </span>
                        </div>
                        {totalItems > 0 && capturedItems.length === totalItems && (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        )}
                        {totalItems > 0 && capturedItems.length > 0 && capturedItems.length < totalItems && (
                          <div className="flex items-center gap-1">
                            <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">In Progress</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Static Camera Section */}
              <div className="mb-10">
                <div className="relative overflow-hidden rounded-2xl border-2 border-blue-200/60 bg-gradient-to-br from-white/90 via-blue-50/30 to-indigo-50/20 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur-sm transition-all duration-500 dark:border-slate-700/60 dark:from-slate-900/90 dark:via-blue-950/20 dark:to-slate-900/80">
                  {/* Camera Header */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
                          <Camera className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Live Camera Preview</h2>
                          <p className="text-xs text-slate-600 dark:text-slate-400">Real-time jewellery capture workspace</p>
                        </div>
                      </div>
                    </div>
                    <span
                      className={
                        captureMode
                          ? 'inline-flex items-center gap-1 rounded-full bg-blue-100/80 px-3 py-1 text-sm font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200'
                          : 'inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-200'
                      }
                    >
                      <span className={`h-2 w-2 rounded-full ${captureMode ? 'bg-blue-500 animate-pulse' : 'bg-slate-400'}`} />
                      {captureMode ? 'Live' : 'Idle'}
                    </span>
                  </div>

                  {/* Camera Selection - REMOVED */}{/*
                  {!captureMode && (
                    <div className="mb-6">
                      <PageCameraSelector
                        context="rbi-compliance"
                        label="Select Camera"
                        onCameraSelected={(camera) => setSelectedCameraId(camera?.deviceId || '')}
                      />
                    </div>
                  )}
                  */}

                  {/* Live Camera Preview */}
                  <LiveCamera
                    ref={cameraRef}
                    currentStepKey={3}
                    selectedDeviceId={selectedCameraId}
                    displayMode="inline"
                    className="mt-6"
                    onReadyChange={(ready) => console.log('RBI Camera Ready:', ready)}
                    onError={(msg) => showToast(msg, 'error')}
                  />

                  {/* Action Buttons */}
                  <div className="mt-6 space-y-3">
                    {/* Camera Control Buttons */}
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      {!captureMode && (
                        <button
                          onClick={handleOpenOverallCamera}
                          className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-700 px-6 py-3 font-bold text-white shadow-xl shadow-blue-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/60"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-800 opacity-0 transition-opacity group-hover/btn:opacity-100" />
                          <span className="relative flex items-center gap-2">
                            <Camera className="h-5 w-5 transition-transform group-hover/btn:rotate-12" />
                            Open Camera
                          </span>
                        </button>
                      )}
                      {captureMode && (
                        <button
                          onClick={() => {
                            cameraRef.current?.closeCamera();
                            setCaptureMode(null);
                            setCurrentCapturingItem(null);
                          }}
                          className="group/btn flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-6 py-3 font-bold text-slate-700 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-slate-400 hover:bg-slate-50 hover:shadow-xl dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                        >
                          <span className="transition-transform group-hover/btn:-translate-x-0.5">←</span>
                          Close Camera
                        </button>
                      )}
                    </div>

                    {/* Capture Buttons - Only show when camera is open */}
                    {captureMode && (
                      <div className="flex flex-wrap items-center justify-center gap-3">
                        <button
                          onClick={handleCaptureOverallImage}
                          className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-3 font-bold text-white shadow-xl shadow-blue-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/50"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-700 opacity-0 transition-opacity group-hover/btn:opacity-100" />
                          <span className="relative flex items-center gap-2">
                            <FileImage className="h-5 w-5" />
                            Capture Overall Image {overallImages.length + 1}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            if (totalItems === 0) {
                              showToast('Please set the number of items first', 'error');
                              return;
                            }
                            const nextItem = Array.from({ length: totalItems }, (_, i) => i + 1)
                              .find(num => !getItemImage(num));
                            if (nextItem) {
                              const imageData = cameraRef.current?.captureImage();
                              if (imageData) {
                                setCapturedItems((prev) => {
                                  const filtered = prev.filter((item) => item.itemNumber !== nextItem);
                                  return [...filtered, { itemNumber: nextItem, image: imageData }];
                                });
                                showToast(`Item ${nextItem} captured!`, 'success');
                              }
                            } else {
                              showToast('All items have been captured', 'info');
                            }
                          }}
                          disabled={totalItems === 0}
                          className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-indigo-500 to-violet-600 px-6 py-3 font-bold text-white shadow-xl shadow-indigo-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-violet-700 opacity-0 transition-opacity group-hover/btn:opacity-100" />
                          <span className="relative flex items-center gap-2">
                            <Camera className="h-5 w-5" />
                            Capture Individual Item
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Enhanced Capture Progress Summary */}
              {(overallImages.length > 0 || capturedItems.length > 0) && (
                <div className="relative overflow-hidden rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50/80 via-indigo-50/50 to-blue-50/80 p-6 shadow-lg shadow-blue-500/5 backdrop-blur-sm dark:border-slate-700/60 dark:from-slate-900/80 dark:via-blue-950/50 dark:to-slate-900/80 mb-10">
                  <div className="absolute top-0 right-0 h-32 w-32 bg-gradient-to-br from-blue-400/10 to-transparent rounded-full blur-2xl" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 shadow-lg shadow-blue-500/30">
                        <Zap className="h-5 w-5 text-white" />
                      </div>
                      <h2 className="text-base font-bold text-blue-900 dark:text-blue-100">Capture Progress</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="text-center p-4 rounded-xl bg-white/60 backdrop-blur-sm dark:bg-slate-800/40">
                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                          {overallImages.length}
                        </div>
                        <div className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                          Overall Images
                        </div>
                      </div>
                      <div className="text-center p-4 rounded-xl bg-white/60 backdrop-blur-sm dark:bg-slate-800/40">
                        <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                          {capturedItems.length} / {totalItems}
                        </div>
                        <div className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">
                          Individual Items
                        </div>
                      </div>
                      <div className="text-center p-4 rounded-xl bg-white/60 backdrop-blur-sm dark:bg-slate-800/40">
                        <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                          {canProceed() ? '✓' : '○'}
                        </div>
                        <div className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">
                          Ready to Proceed
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex items-start gap-3 rounded-xl border-2 border-blue-300/40 bg-white/70 p-4 shadow-sm backdrop-blur-sm dark:border-blue-700/40 dark:bg-slate-800/70">
                      <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                        You can proceed with either complete overall images OR all individual item captures.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Enhanced Overall Images Gallery */}
            {overallImages.length > 0 && (
              <div className="mb-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 p-2">
                    <FileImage className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-blue-800 dark:text-blue-100">
                    Overall Collection Images ({overallImages.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {overallImages.map((img) => (
                    <div key={img.id} className="group space-y-3">
                      <div className="relative overflow-hidden rounded-3xl border-4 border-blue-400/70 shadow-2xl shadow-blue-500/20 bg-gradient-to-br from-blue-50 to-indigo-50 transition-all duration-300 group-hover:shadow-blue-600/30 group-hover:-translate-y-1">
                        <img
                          src={img.image}
                          alt={`Overall Collection ${img.id}`}
                          className="w-full h-56 object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
                        <div className="absolute top-3 left-3">
                          <div className="rounded-full bg-blue-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
                            Overall {img.id}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveOverallImage(img.id)}
                          className="absolute top-3 right-3 rounded-full bg-red-500 p-2 text-white shadow-lg transition-all duration-300 hover:bg-red-600 hover:shadow-xl"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Individual Items Grid - Only show if items have been captured */}
            {totalItems > 0 && capturedItems.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-900">
                    Individual Item Captures
                  </h3>
                  <span className="text-sm font-semibold text-gray-600">
                    {capturedItems.length} / {totalItems} completed
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {Array.from({ length: totalItems }, (_, i) => i + 1).map((itemNumber) => {
                    const itemImage = getItemImage(itemNumber);
                    return itemImage ? (
                      <div key={itemNumber} className="space-y-2">
                        <div className="aspect-square">
                          <div className="relative h-full rounded-lg overflow-hidden border-2 border-green-500 shadow-md">
                            <img
                              src={itemImage}
                              alt={`Item ${itemNumber}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute top-1 right-1 bg-green-500 rounded-full p-1">
                              <CheckCircle className="w-4 h-4 text-white" />
                            </div>
                          </div>
                        </div>
                        <p className="text-xs font-semibold text-gray-700 text-center">
                          Item {itemNumber}
                        </p>
                      </div>
                    ) : null;
                  })}
                </div>

                {totalItems > 0 && capturedItems.length === totalItems && (
                  <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-800 text-center font-semibold">
                      All {totalItems} items captured successfully!
                    </p>
                  </div>
                )}

                {/* Status Messages */}
                {totalItems > 0 && overallImages.length > 0 && (
                  <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-800 text-center font-semibold flex items-center justify-center gap-2">
                      <CheckCircle className="w-5 h-5" />
                      Overall images captured! Ready to proceed.
                      {capturedItems.length > 0 && (
                        <span className="block mt-1 text-green-700 text-sm">
                          (+ {capturedItems.length} individual items also captured)
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {totalItems > 0 && overallImages.length === 0 && capturedItems.length > 0 && capturedItems.length < totalItems && (
                  <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-amber-800 text-center font-semibold">
                      Individual capture in progress: {capturedItems.length} out of {totalItems} items captured.
                      <span className="block mt-1 text-amber-700">
                        Complete all individual items or capture overall images to proceed.
                      </span>
                    </p>
                  </div>
                )}

                {totalItems > 0 && overallImages.length === 0 && capturedItems.length === totalItems && (
                  <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-800 text-center font-semibold flex items-center justify-center gap-2">
                      <CheckCircle className="w-5 h-5" />
                      All {totalItems} individual items captured! Ready to proceed.
                    </p>
                  </div>
                )}

                {totalItems > 0 && overallImages.length === 0 && capturedItems.length === 0 && (
                  <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-blue-800 text-center font-semibold">
                      Choose your approach: Capture overall images OR capture all {totalItems} individual items.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Premium Footer - Full Width */}
            <div className="border-t-2 border-slate-200/60 bg-gradient-to-r from-slate-50/90 via-white/90 to-slate-50/90 backdrop-blur-sm dark:border-slate-800/60 dark:from-slate-900/90 dark:via-slate-900/95 dark:to-slate-900/90">
              <div className="container mx-auto max-w-7xl px-8 py-6">
                <div className="flex flex-col items-center justify-center gap-4 md:flex-row md:gap-6">
                  <button
                    onClick={() => navigate('/customer-image')}
                    className="group/btn flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 font-bold text-slate-700 shadow-lg ring-2 ring-slate-200 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:ring-slate-600"
                  >
                    <ArrowLeft className="h-4 w-4 transition-transform group-hover/btn:-translate-x-1" />
                    Back to Previous
                  </button>

                  {/* GPS Info */}
                  <div className="flex-1 flex justify-center">
                    {gpsLoading ? (
                      <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="font-medium text-sm">Getting location...</span>
                      </div>
                    ) : gpsError ? (
                      <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                        <AlertCircle className="h-5 w-5" />
                        <span className="font-medium text-sm">{gpsError}</span>
                      </div>
                    ) : gpsData ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <MapPin className="h-4 w-4 text-blue-500" />
                          <span>
                            {gpsData.latitude.toFixed(6)}, {gpsData.longitude.toFixed(6)}
                          </span>
                          {gpsData.address && (
                            <span className="text-slate-600 dark:text-slate-400">
                              • {gpsData.address}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <button
                    onClick={handleNext}
                    disabled={isLoading || !canProceed()}
                    className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-700 px-8 py-2.5 font-bold text-white shadow-xl shadow-blue-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                    title={getNextButtonStatus().title}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-800 opacity-0 transition-opacity group-hover/btn:opacity-100" />
                    <span className="relative flex items-center gap-2">
                      {isLoading ? (
                        <>
                          <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Saving...
                        </>
                      ) : (
                        <>
                          {getNextButtonStatus().text}
                          <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div >
  );
}

export default RBICompliance;
