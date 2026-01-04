import {useMemo, useState, useRef, useEffect,useCallback } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, ArrowRight, Shield, CheckCircle, Sparkles, FileImage, Settings, Zap,MapPin, Globe, AlertCircle, Loader2 } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { CameraSelector } from '../components/CameraSelector';
import { showToast } from '../lib/utils';

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
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;

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
    
    if (!frontImage) {
      showToast('Please complete customer image capture first', 'error');
      navigate('/customer-image');
      return;
    }
    fetchGPS();
    // ADD THIS BLOCK - Logs all cameras in console
  const logAvailableCameras = async () => {
    try {
      // First, request permission (required to get real labels)
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop()); // Stop immediately

      // Now enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(device => device.kind === 'videoinput');

      console.log('CAMERAS DETECTED:', videoInputs.length);
      console.log('Available Cameras:');

      videoInputs.forEach((device, index) => {
        console.log(`  [${index + 1}] ${device.label || 'Unknown Camera'}`, {
          deviceId: device.deviceId,
          label: device.label,
          groupId: device.groupId
        });
      });

      if (videoInputs.length === 0) {
        console.warn('No cameras found! Check connection or permissions.');
      } else if (videoInputs.length === 1) {
        console.log('Only 1 camera detected (probably built-in)');
      } else {
        console.log(`${videoInputs.length} cameras detected - you can switch!`);
      }

    } catch (err) {
      console.error('Failed to access cameras:', err);
      console.warn('Camera access denied or not available');
    }
  };

  logAvailableCameras();
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
      console.log('=== SAVING RBI COMPLIANCE DATA ===');
      console.log('Overall images count:', overallImages.length);
      console.log('Total items:', totalItems);
      console.log('Captured items:', capturedItems.length);
      console.log('Captured items data:', capturedItems);
      console.log('Validation - hasCompleteOverall:', hasCompleteOverall);
      console.log('Validation - hasCompleteIndividual:', hasCompleteIndividual);

      // Store jewellery items in localStorage
      console.log('Step 1: Creating jewellery items data...');
      
      let jewelleryItemsData;
      
      if (capturedItems.length === totalItems) {
        // Use individual item images
        jewelleryItemsData = capturedItems.map((item) => ({
          itemNumber: item.itemNumber,
          image: item.image,
          description: `Item ${item.itemNumber}`,
        }));
        console.log('Using individual item images:', jewelleryItemsData.length, 'items');
      } else if (overallImages.length > 0) {
        // Use overall images for all items
        const overallImage = overallImages[0].image; // Use first overall image
        jewelleryItemsData = Array.from({ length: totalItems }, (_, index) => ({
          itemNumber: index + 1,
          image: overallImage,
          description: `Item ${index + 1} (from overall image)`,
        }));
        console.log('Using overall image for all items:', jewelleryItemsData.length, 'items');
      } else {
        throw new Error('No images available for jewellery items');
      }

      // Validate jewellery items data
      if (!jewelleryItemsData || jewelleryItemsData.length === 0) {
        throw new Error('Failed to create jewellery items data');
      }

      if (jewelleryItemsData.length !== totalItems) {
        throw new Error(`Jewellery items count mismatch: expected ${totalItems}, got ${jewelleryItemsData.length}`);
      }

      console.log('Step 2: Storing jewellery items in localStorage...');
      localStorage.setItem('jewelleryItems', JSON.stringify(jewelleryItemsData));
      console.log('✓ Jewellery items stored:', jewelleryItemsData);
      
      // Store RBI compliance data
      console.log('Step 3: Creating RBI compliance data...');
      const rbiComplianceData = {
        overallImages,
        totalItems,
        capturedItems,
        captureMethod: capturedItems.length === totalItems ? 'individual' : 'overall',
        timestamp: new Date().toISOString(),
      };
      console.log('RBI compliance data created');
      
      console.log('Step 4: Storing RBI compliance in localStorage...');
      localStorage.setItem('rbiCompliance', JSON.stringify(rbiComplianceData));
      console.log('✓ RBI compliance stored');

      console.log('=== DATA STORED SUCCESSFULLY ===');
      console.log('Jewellery items stored:', jewelleryItemsData.length);
      console.log('RBI compliance stored');

      // Verify storage
      const storedItems = localStorage.getItem('jewelleryItems');
      const storedRBI = localStorage.getItem('rbiCompliance');
      console.log('Verification - Items in storage:', storedItems ? 'YES' : 'NO');
      console.log('Verification - RBI in storage:', storedRBI ? 'YES' : 'NO');

      showToast('RBI compliance data saved!', 'success');
      
      console.log('=== NAVIGATING TO PURITY TESTING ===');
      navigate('/purity-testing');
    } catch (error: any) {
      console.error('=== ERROR SAVING RBI COMPLIANCE ===');
      console.error('Error type:', typeof error);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      console.error('Full error:', error);
      console.error('Current state:', {
        totalItems,
        overallImagesCount: overallImages.length,
        capturedItemsCount: capturedItems.length,
        hasCompleteOverall,
        hasCompleteIndividual
      });
      showToast(`Failed to save RBI compliance data: ${error?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-sky-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950">
      {/* Enhanced background with animated gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_800px_600px_at_50%_-200px,_rgba(59,130,246,0.15),_transparent),_radial-gradient(ellipse_600px_400px_at_80%_100%,_rgba(99,102,241,0.12),_transparent)]" />
      <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-blue-50/40 dark:from-slate-950/80 dark:via-slate-900/60 dark:to-blue-950/80" />
      
      {/* Floating decorative elements */}
      <div className="absolute top-20 left-10 w-20 h-20 bg-gradient-to-br from-blue-400/20 to-indigo-500/20 rounded-full blur-xl animate-pulse" />
      <div className="absolute top-40 right-20 w-32 h-32 bg-gradient-to-br from-indigo-400/15 to-sky-500/15 rounded-full blur-2xl animate-pulse delay-1000" />
      <div className="absolute bottom-20 left-1/4 w-24 h-24 bg-gradient-to-br from-sky-400/20 to-blue-500/20 rounded-full blur-xl animate-pulse delay-2000" />
      
      <div className="relative z-10">
        <StepIndicator currentStep={3} />

        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="overflow-hidden rounded-3xl border border-white/20 bg-white/80 backdrop-blur-2xl shadow-2xl shadow-blue-500/10 dark:border-slate-700/30 dark:bg-slate-900/70">
            {/* Enhanced header with gradient and icons */}
            <div className="relative bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-600 px-10 py-8">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/90 via-indigo-600/90 to-sky-600/90" />
              <div className="absolute top-0 left-0 w-full h-full opacity-10">
                <div className="grid grid-cols-12 gap-2 h-full">
                  {Array.from({ length: 48 }).map((_, i) => (
                    <div key={i} className="w-1 h-1 bg-white rounded-full opacity-30" />
                  ))}
                </div>
              </div>
              
              <div className="relative flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-4">
                  <div className="relative rounded-2xl bg-white/20 p-4 shadow-lg backdrop-blur-sm">
                    <Shield className="h-10 w-10 text-white" />
                    <div className="absolute -top-1 -right-1 rounded-full bg-yellow-400 p-1">
                      <CheckCircle className="h-3 w-3 text-white" />
                    </div>
                  </div>
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-yellow-300" />
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-blue-100">
                      RBI Compliance Image
                    </p>
                  </div>
                  <h1 className="text-4xl font-bold text-white drop-shadow-lg mb-2 bg-gradient-to-r from-white to-blue-100 bg-clip-text">
                    RBI Compliance Image
                  </h1>
                  <p className="text-lg text-blue-100/90 font-medium">
                    Step 3 of 5 — Regulatory compliance imaging
                  </p>
                </div>
              </div>
            </div>

            <div className="p-12 space-y-10">
              {/* Enhanced items count section */}
              <div className="space-y-6">
                <div className="relative">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 p-2">
                      <Settings className="h-5 w-5 text-white" />
                    </div>
                    <label className="text-xl font-bold text-slate-800 dark:text-slate-100">
                      Enter Number of Jewellery
                      <span className="ml-2 text-red-500 text-xl">*</span>
                    </label>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                    Enter the total number of jewellery items to be documented for compliance
                  </p>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={totalItems || ''}
                      onChange={(e) => setTotalItems(parseInt(e.target.value) || 0)}
                      placeholder="Enter number of jewellery"
                      className="w-full px-6 py-4 text-lg font-semibold border-2 border-blue-200/60 rounded-2xl bg-gradient-to-r from-blue-50/50 to-indigo-50/50 focus:ring-4 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all duration-300 placeholder:text-slate-400 dark:border-blue-500/30 dark:bg-slate-800/50 dark:text-blue-100"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      <div className="rounded-lg bg-blue-500 px-3 py-1 text-xs font-bold text-white">
                        Items
                      </div>
                    </div>
                  </div>
                </div>

              {/* Enhanced Two Main Action Buttons */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <button
                  onClick={handleOpenOverallCamera}
                  className="group relative p-8 border-3 border-dashed border-blue-300/60 rounded-3xl bg-gradient-to-br from-blue-50/60 via-indigo-50/40 to-blue-50/60 hover:border-blue-400/80 hover:from-blue-100/70 hover:via-indigo-100/50 hover:to-blue-100/70 hover:shadow-xl transition-all duration-300 dark:border-blue-500/40 dark:bg-slate-800/40 dark:hover:bg-slate-700/60"
                >
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-400/5 via-indigo-400/5 to-blue-400/5" />
                  <div className="relative flex flex-col items-center justify-center gap-4">
                    <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-4 shadow-lg group-hover:shadow-xl transition-all duration-300">
                      <FileImage className="h-10 w-10 text-white" />
                    </div>
                    <div className="text-center">
                      <h3 className="text-xl font-bold text-blue-800 group-hover:text-blue-900 dark:text-blue-300 dark:group-hover:text-blue-200">
                        Overall Collection
                      </h3>
                      <p className="text-sm text-blue-600 dark:text-blue-400 mt-1">
                        Capture all items together
                      </p>
                      <div className="mt-3 rounded-full bg-blue-100 px-4 py-2 dark:bg-blue-900/40">
                        <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                          {overallImages.length} captured
                        </span>
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={handleOpenIndividualCamera}
                  disabled={totalItems === 0}
                  className={`group relative p-8 border-3 border-dashed rounded-3xl transition-all duration-300 ${
                    totalItems === 0
                      ? 'border-slate-300 bg-slate-50 cursor-not-allowed opacity-60'
                      : 'border-indigo-300/60 bg-gradient-to-br from-indigo-50/60 via-sky-50/40 to-indigo-50/60 hover:border-indigo-400/80 hover:from-indigo-100/70 hover:via-sky-100/50 hover:to-indigo-100/70 hover:shadow-xl dark:border-indigo-500/40 dark:bg-slate-800/40 dark:hover:bg-slate-700/60'
                  }`}
                >
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-400/5 via-sky-400/5 to-indigo-400/5" />
                  <div className="relative flex flex-col items-center justify-center gap-4">
                    <div className={`rounded-2xl p-4 shadow-lg transition-all duration-300 ${
                      totalItems === 0
                        ? 'bg-slate-400'
                        : 'bg-gradient-to-br from-indigo-500 to-sky-600 group-hover:shadow-xl'
                    }`}>
                      <Camera className="h-10 w-10 text-white" />
                    </div>
                    <div className="text-center">
                      <h3 className={`text-xl font-bold ${
                        totalItems === 0
                          ? 'text-slate-500'
                          : 'text-indigo-800 group-hover:text-indigo-900 dark:text-indigo-300 dark:group-hover:text-indigo-200'
                      }`}>
                        Individual Items
                      </h3>
                      <p className={`text-sm mt-1 ${
                        totalItems === 0
                          ? 'text-slate-400'
                          : 'text-indigo-600 dark:text-indigo-400'
                      }`}>
                        {totalItems === 0 ? 'Set item count first' : 'Capture each item separately'}
                      </p>
                      <div className={`mt-3 rounded-full px-4 py-2 ${
                        totalItems === 0
                          ? 'bg-slate-100'
                          : 'bg-indigo-100 dark:bg-indigo-900/40'
                      }`}>
                        <span className={`text-sm font-bold ${
                          totalItems === 0
                            ? 'text-slate-500'
                            : 'text-indigo-700 dark:text-indigo-300'
                        }`}>
                          {capturedItems.length} / {totalItems} completed
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>

              {/* Enhanced Capture Progress Summary */}
              {(overallImages.length > 0 || capturedItems.length > 0) && (
                <div className="rounded-3xl border-2 border-blue-200/70 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 p-6 shadow-lg dark:border-blue-500/30 dark:from-blue-950/40 dark:to-indigo-950/30">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-lg bg-blue-500 p-2">
                      <Zap className="h-5 w-5 text-white" />
                    </div>
                    <h4 className="text-xl font-bold text-blue-800 dark:text-blue-100">
                      Capture Progress
                    </h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 rounded-2xl bg-white/60 dark:bg-blue-900/30">
                      <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {overallImages.length}
                      </div>
                      <div className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                        Overall Images
                      </div>
                    </div>
                    <div className="text-center p-4 rounded-2xl bg-white/60 dark:bg-indigo-900/30">
                      <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                        {capturedItems.length} / {totalItems}
                      </div>
                      <div className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">
                        Individual Items
                      </div>
                    </div>
                    <div className="text-center p-4 rounded-2xl bg-white/60 dark:bg-sky-900/30">
                      <div className="text-lg font-bold text-sky-600 dark:text-sky-400">
                        {canProceed() ? '✓' : '○'}
                      </div>
                      <div className="text-sm text-sky-700 dark:text-sky-300 font-medium">
                        Ready to Proceed
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 p-4 rounded-2xl bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30">
                    <p className="text-sm text-blue-800 dark:text-blue-200 text-center leading-relaxed">
                      💡 <strong>Tip:</strong> You can proceed with either complete overall images OR all individual item captures
                    </p>
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
          </div>

          {/* Enhanced footer */}
          <div className="border-t border-blue-100/70 bg-gradient-to-r from-blue-50/80 via-indigo-50/60 to-sky-50/80 px-10 py-8 dark:border-blue-500/30 dark:from-blue-950/60 dark:via-indigo-950/50 dark:to-sky-950/60">
            <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
              {/* Previous Button */}
              <button
                onClick={() => navigate('/customer-image')}
                className="flex items-center gap-3 rounded-2xl bg-white/90 px-8 py-4 font-bold text-slate-700 shadow-lg ring-2 ring-slate-200/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-slate-300/60 dark:bg-slate-800/80 dark:text-slate-300 dark:ring-slate-600/50 dark:hover:ring-slate-500/60"
              >
                <ArrowLeft className="h-5 w-5" />
                Previous Step
              </button>
              
              {/* GPS Info + Map */}
              <div className="flex-1 flex justify-center">
                {gpsLoading ? (
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="font-medium">Getting location...</span>
                  </div>
                ) : gpsError ? (
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-medium">{gpsError}</span>
                  </div>
                ) : gpsData ? (
                  <div className="flex flex-col items-center gap-3 max-w-md">
                    <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                      <MapPin className="h-5 w-5" />
                      <span>
                        {gpsData.latitude.toFixed(6)}, {gpsData.longitude.toFixed(6)}
                      </span>
                      <Globe className="h-4 w-4 text-indigo-600" />
                      <span className="text-xs uppercase tracking-wider">
                        {gpsData.source}
                      </span>
                      {/* Address - same color, right-aligned */}
                      <span className="ml-3 text-blue-700 dark:text-blue-300 font-medium text-sm">
                        {gpsData.address || 'Address not available'}
                      </span>
                    </div>
                    {gpsData.map_image && (
                      <img
                        src={gpsData.map_image}
                        alt="GPS Location Map"
                        className="w-48 h-48 rounded-xl border border-blue-200 shadow-lg object-cover"
                      />
                    )}
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Captured: {new Date(gpsData.timestamp).toLocaleString('en-IN')}
                    </p>
                  </div>
                ) : null}
              </div>

              
              {/* Next Button */}
              <div className="flex items-center gap-4">
                {canProceed() && (
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <div className="rounded-full bg-blue-500 p-1">
                      <CheckCircle className="h-3 w-3 text-white" />
                    </div>
                    <span className="text-sm font-semibold">Documentation complete</span>
                  </div>
                )}
                
                <button
                  onClick={handleNext}
                  disabled={isLoading || !canProceed()}
                  className={`flex items-center gap-3 rounded-2xl px-8 py-4 font-bold text-white shadow-xl transition-all duration-300 ${
                    canProceed() && !isLoading
                      ? 'bg-gradient-to-r from-blue-500 via-indigo-500 to-sky-600 shadow-blue-500/30 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/40 active:translate-y-0'
                      : 'bg-slate-400 cursor-not-allowed shadow-slate-400/30'
                  }`}
                  title={getNextButtonStatus().title}
                >
                  {isLoading ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Processing...
                    </>
                  ) : (
                    <>
                      {getNextButtonStatus().text}
                      <ArrowRight className="h-5 w-5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Camera Selection - shown only when camera is not open */}
      {!captureMode && (
        <div className="fixed bottom-8 right-8 z-40 max-w-md">
          <CameraSelector
            onCameraSelect={setSelectedCameraId}
            selectedDeviceId={selectedCameraId}
            autoDetect={true}
          />
        </div>
      )}

      <LiveCamera 
        ref={cameraRef} 
        currentStepKey={3}
        selectedDeviceId={selectedCameraId}
      />

      {cameraRef.current && captureMode && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50">
          <button
            onClick={captureMode === 'overall' ? handleCaptureOverallImage : handleCaptureItem}
            className="px-8 py-4 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-full font-bold text-lg shadow-2xl hover:shadow-3xl transition-all flex items-center gap-3"
          >
            <Camera className="w-6 h-6" />
            {captureMode === 'overall'
              ? `Capture Overall Image ${overallImages.length + 1}`
              : currentCapturingItem !== null 
                ? `Capture Item ${currentCapturingItem}`
                : 'Capture Item'}
          </button>
        </div>
      )}
    </div>
  </div>
  );
}

export default RBICompliance;
