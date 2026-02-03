import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, ArrowRight, Shield, CheckCircle, Sparkles, FileImage, Zap, MapPin, Globe, AlertCircle, Loader2, X, Scan, Award } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { showToast, cn } from '../lib/utils';
import { ModernDashboardLayout } from '../components/layouts/ModernDashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

interface ClassificationResult {
  class_name: string;
  confidence: number;
  risk: string;
  all_predictions?: Array<{ class_name: string; confidence: number }>;
}

interface DetectedRegion {
  region_name: string;
  class_name: string;
  confidence: number;
  sam_score: number;
  image: string;
}

interface JewelleryItemCapture {
  itemNumber: number;
  image: string;
  classification?: ClassificationResult;
  detectedRegions?: DetectedRegion[];
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
  const [classifying, setClassifying] = useState<number | null>(null);
  const [enhancedMode, setEnhancedMode] = useState(false);
  const [showRegionsPanel, setShowRegionsPanel] = useState(false);
  const [detectedRegions, setDetectedRegions] = useState<DetectedRegion[]>([]);
  const [selectedItemForRegions, setSelectedItemForRegions] = useState<number | null>(null);
  const [showRiskReport, setShowRiskReport] = useState(false);
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

  const handleRiskAnalysis = async (itemNumber: number) => {
    const item = capturedItems.find(i => i.itemNumber === itemNumber);
    if (!item || !item.image) {
      showToast('No image found for this item', 'error');
      return;
    }

    setClassifying(itemNumber);
    setShowRegionsPanel(true);
    setSelectedItemForRegions(itemNumber);

    try {
      // Run both analyses in parallel for faster results
      const [classifyResponse, enhancedResponse] = await Promise.all([
        // Simple ResNet50 classification
        fetch(`${import.meta.env.VITE_API_URL}/api/classification/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: item.image, item_number: itemNumber })
        }),
        // SAM3 enhanced detection
        fetch(`${import.meta.env.VITE_API_URL}/api/classification/analyze-enhanced`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: item.image, item_number: itemNumber })
        })
      ]);

      if (!classifyResponse.ok || !enhancedResponse.ok) {
        throw new Error('Risk analysis failed');
      }

      const [classifyResult, enhancedResult] = await Promise.all([
        classifyResponse.json(),
        enhancedResponse.json()
      ]);

      // Update item with both classification and detected regions
      if (classifyResult.success) {
        const regions = enhancedResult.success ? enhancedResult.regions : [];
        setDetectedRegions(regions);

        setCapturedItems(prev =>
          prev.map(i =>
            i.itemNumber === itemNumber
              ? {
                ...i,
                classification: classifyResult,
                detectedRegions: regions
              }
              : i
          )
        );

        const componentsMsg = regions.length > 0 ? ` | ${regions.length} components detected` : '';
        showToast(
          `${classifyResult.class_name} (${classifyResult.confidence}%)${componentsMsg}`,
          'success'
        );
      } else {
        const error = classifyResult.error || enhancedResult.error || 'Analysis failed';
        showToast(error, 'error');
        setDetectedRegions([]);
      }
    } catch (error: any) {
      console.error('Risk analysis error:', error);
      showToast('Failed to run risk analysis', 'error');
      setDetectedRegions([]);
    } finally {
      setClassifying(null);
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
        navigate('/customer-image');
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
    <ModernDashboardLayout
      title="RBI Compliance Documentation"
      showSidebar
      headerContent={<StepIndicator currentStep={3} />}
    >
      <div className="max-w-6xl mx-auto space-y-6 pb-20">

        {/* Input Section */}
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Jewellery Item Count
            </CardTitle>
            <CardDescription className="text-xs">Specify total items to appraise.</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-col md:flex-row items-end gap-4">
              <div className="w-full max-w-[200px] space-y-1">
                <label className="text-xs font-medium flex items-center gap-1">
                  Total Items <span className="text-destructive">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={totalItems || ''}
                    onChange={(e) => setTotalItems(parseInt(e.target.value) || 0)}
                    placeholder="1-50"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex-1 pb-1">
                {totalItems > 0 ? (
                  <div className="flex items-center gap-2 text-xs text-success font-medium">
                    <CheckCircle className="w-3 h-3" />
                    <span>Ready ({totalItems} items)</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Enter number of items.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>



        {/* Live Camera Section */}
        <Card className="overflow-hidden border-2 border-border/50">
          <div className="bg-muted/30 p-3 flex items-center justify-between border-b h-12">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">Live Camera Workspace</h3>
            </div>
            <div className="flex items-center gap-3">
              {captureMode && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-secondary text-secondary-foreground animate-pulse">
                  LIVE: {captureMode === 'overall' ? 'OVERALL' : 'INDIVIDUAL'}
                </span>
              )}
            </div>
          </div>

          <CardContent className="p-0">
            {/* Live Camera - Always mounted to preserve ref, visibility toggled via CSS */}
            <div className={cn("p-4 bg-black/5 min-h-[300px]", !captureMode && "hidden")}>
              <LiveCamera
                ref={cameraRef}
                currentStepKey={3}
                selectedDeviceId={selectedCameraId}
                displayMode="inline"
                onReadyChange={(ready) => console.log('RBI Camera Ready:', ready)}
                onError={(msg) => showToast(msg, 'error')}
              />
            </div>

            {/* Selection UI - Shown when not capturing */}
            {!captureMode && (
              <div className="p-4 min-h-[300px] bg-muted/10">
                {overallImages.length > 0 || capturedItems.length > 0 ? (
                  <div className="space-y-4">
                    {/* Overall Images Preview */}
                    {overallImages.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium flex items-center gap-2">
                            <FileImage className="w-4 h-4 text-primary" />
                            Overall Images ({overallImages.length})
                          </h4>
                          <Button size="sm" variant="outline" onClick={handleOpenOverallCamera} className="gap-1">
                            <Camera className="w-3 h-3" /> Add More
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {overallImages.slice(0, 6).map((img) => (
                            <div key={img.id} className="group relative aspect-video rounded-lg overflow-hidden border-2 border-success/30 shadow-sm">
                              <img src={img.image} alt={`Overall ${img.id}`} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                <button
                                  onClick={() => handleRemoveOverallImage(img.id)}
                                  className="p-2 bg-destructive text-white rounded-lg hover:bg-destructive/90"
                                  title="Remove"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                              <div className="absolute top-1 right-1">
                                <StatusBadge variant="success" size="sm">
                                  <CheckCircle className="w-3 h-3" />
                                </StatusBadge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Individual Items Preview */}
                    {capturedItems.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium flex items-center gap-2">
                            <Zap className="w-4 h-4 text-secondary-foreground" />
                            Individual Items ({capturedItems.length}/{totalItems})
                          </h4>
                          <div className="flex items-center gap-2">
                            {capturedItems.length < totalItems && (
                              <Button size="sm" variant="outline" onClick={handleOpenIndividualCamera} className="gap-1">
                                <Camera className="w-3 h-3" /> Capture Next
                              </Button>
                            )}
                            {(overallImages.length > 0 || capturedItems.length > 0) && (
                              <Button
                                size="sm"
                                variant={showRiskReport ? "secondary" : "outline"}
                                onClick={() => setShowRiskReport(!showRiskReport)}
                                className="gap-1.5"
                              >
                                <Award className={cn("w-3.5 h-3.5", showRiskReport && "text-primary-foreground")} />
                                {showRiskReport ? "Hide Risk Analysis" : "Show Risk Analysis"}
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {Array.from({ length: Math.min(totalItems, 8) }, (_, i) => i + 1).map((itemNumber) => {
                            const item = capturedItems.find(i => i.itemNumber === itemNumber);
                            const itemImage = item?.image;
                            const classification = item?.classification;

                            return (
                              <div
                                key={itemNumber}
                                className={cn(
                                  "group relative aspect-square rounded-lg overflow-hidden border-2",
                                  itemImage ? "border-success/30" : "border-dashed border-muted-foreground/30 bg-muted/20"
                                )}
                              >
                                {itemImage ? (
                                  <>
                                    <img src={itemImage} alt={`Item ${itemNumber}`} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1">
                                      <button
                                        onClick={() => handleOpenItemCamera(itemNumber)}
                                        className="p-1.5 bg-primary text-white rounded-lg hover:bg-primary/90 text-xs"
                                        title="Retake"
                                      >
                                        <Camera className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => handleRiskAnalysis(item.itemNumber)}
                                        disabled={classifying === itemNumber}
                                        className="p-1.5 bg-secondary text-white rounded-lg hover:bg-secondary/90 text-xs disabled:opacity-50"
                                        title="Classify"
                                      >
                                        {classifying === itemNumber ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <Scan className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                    <span className="absolute bottom-1 left-1 text-xs font-bold text-white bg-black/50 px-1 rounded">#{itemNumber}</span>
                                    {classification && (
                                      <div className="absolute top-1 right-1">
                                        <StatusBadge
                                          variant="success"
                                          size="sm"
                                        >
                                          <Award className="w-3 h-3" />
                                        </StatusBadge>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div
                                    className="w-full h-full flex flex-col items-center justify-center cursor-pointer hover:bg-muted/40 transition-colors"
                                    onClick={() => handleOpenItemCamera(itemNumber)}
                                  >
                                    <Camera className="w-5 h-5 text-muted-foreground mb-1" />
                                    <span className="text-xs text-muted-foreground">#{itemNumber}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-6">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Camera className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <h4 className="font-medium text-foreground">Start Capture</h4>
                      <p className="text-xs text-muted-foreground max-w-sm">
                        Select a mode to begin capturing images
                      </p>
                    </div>

                    <div className="flex gap-4 w-full max-w-md">
                      <Button
                        onClick={handleOpenOverallCamera}
                        variant="outline"
                        className="flex-1 h-auto py-4 flex flex-col gap-2 hover:border-primary hover:bg-primary/5"
                      >
                        <FileImage className="w-5 h-5 text-primary" />
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm">Overall Collection</span>
                          <span className="text-[10px] text-muted-foreground">Capture all items</span>
                        </div>
                      </Button>

                      <Button
                        onClick={totalItems > 0 ? handleOpenIndividualCamera : undefined}
                        disabled={totalItems === 0}
                        variant="outline"
                        className="flex-1 h-auto py-4 flex flex-col gap-2 hover:border-secondary hover:bg-secondary/5"
                      >
                        <Camera className="w-5 h-5 text-secondary-foreground" />
                        <div className="flex flex-col">
                          <span className="font-semibold text-sm">Individual Items</span>
                          <span className="text-[10px] text-muted-foreground">Capture separately</span>
                        </div>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Camera Controls */}
            <div className="p-6 border-t bg-background">
              <div className="flex flex-wrap items-center justify-center gap-4">
                {!captureMode ? (
                  <div className="text-center space-y-3">
                    <p className="text-muted-foreground text-sm">Select a capture method above to start the camera</p>
                    <Button onClick={handleOpenOverallCamera} className="w-48">
                      Open Camera
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => {
                      cameraRef.current?.closeCamera();
                      setCaptureMode(null);
                      setCurrentCapturingItem(null);
                    }}>
                      Close Camera
                    </Button>

                    {captureMode === 'overall' && (
                      <Button onClick={handleCaptureOverallImage} className="gap-2 min-w-[200px]">
                        <Camera className="w-4 h-4" />
                        Capture Overall Image
                      </Button>
                    )}

                    {captureMode === 'individual' && (
                      <Button
                        onClick={handleCaptureItem}
                        disabled={totalItems === 0}
                        variant="secondary"
                        className="gap-2 min-w-[200px]"
                      >
                        <Camera className="w-4 h-4" />
                        Capture Item {currentCapturingItem || ''}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>


        {/* Image Galleries - Risk Analysis View */}
        {showRiskReport && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">


            {/* Individual Gallery - Only shown in Risk Report mode */}
            {showRiskReport && capturedItems.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Zap className="w-5 h-5 text-secondary-foreground" />
                  Captured Individual Items
                </h3>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
                  {Array.from({ length: totalItems }, (_, i) => i + 1).map((itemNumber) => {
                    const item = capturedItems.find(i => i.itemNumber === itemNumber);
                    const itemImage = item?.image;
                    const classification = item?.classification;

                    return (
                      <div key={itemNumber} className={cn(
                        "rounded-xl border p-2 transition-all",
                        itemImage ? "bg-background border-success/30" : "bg-muted/20 border-border border-dashed"
                      )}>
                        <div className="aspect-square rounded-lg overflow-hidden bg-muted mb-2 relative">
                          {itemImage ? (
                            <>
                              <img src={itemImage} alt={`Item ${itemNumber}`} className="w-full h-full object-cover" />
                              <div className="absolute top-1 right-1 bg-success text-white rounded-full p-0.5">
                                <CheckCircle className="w-3 h-3" />
                              </div>
                              {classification && (
                                <div className="absolute top-1 left-1">
                                  <StatusBadge
                                    variant="success"
                                    size="sm"
                                  >
                                    {classification.class_name?.substring(0, 12) || 'Classified'}
                                  </StatusBadge>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                              <span className="text-xs">Pending</span>
                            </div>
                          )}
                        </div>
                        <p className={cn(
                          "text-xs text-center font-medium mb-1",
                          itemImage ? "text-foreground" : "text-muted-foreground"
                        )}>
                          Item {itemNumber}
                        </p>
                        {classification && (
                          <div className="space-y-1">
                            <p className="text-xs text-center font-semibold text-foreground truncate" title={classification.class_name || 'Classified'}>
                              {classification.class_name || 'Classified'}
                            </p>
                            <p className="text-[10px] text-center text-muted-foreground">
                              {classification.confidence}% confidence
                            </p>
                            {/* Risk Level Badge */}
                            {classification.risk && (
                              <div className="flex items-center justify-center">
                                <span className={cn(
                                  "text-[10px] font-bold px-2 py-0.5 rounded",
                                  classification.risk === 'HIGH' ? 'bg-red-500/20 text-red-700 dark:text-red-400' :
                                    classification.risk === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' :
                                      'bg-green-500/20 text-green-700 dark:text-green-400'
                                )}>
                                  {classification.risk}
                                </span>
                              </div>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full h-6 text-[10px]"
                              onClick={() => handleRiskAnalysis(itemNumber)}
                              disabled={classifying === itemNumber}
                            >
                              {classifying === itemNumber ? (
                                <><Loader2 className="w-2 h-2 mr-1 animate-spin" /> Analyzing...</>
                              ) : (
                                <><Award className="w-2 h-2 mr-1" /> Re-analyze</>
                              )}
                            </Button>
                          </div>
                        )}
                        {itemImage && !classification && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full h-6 text-[10px]"
                            onClick={() => handleRiskAnalysis(itemNumber)}
                            disabled={classifying === itemNumber}
                          >
                            {classifying === itemNumber ? (
                              <><Loader2 className="w-2 h-2 mr-1 animate-spin" /> Analyzing...</>
                            ) : (
                              <><Award className="w-2 h-2 mr-1" /> Risk Analysis</>
                            )}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Detected Regions Panel - Enhanced UI */}
            {showRegionsPanel && detectedRegions.length > 0 && (
              <Card className="border-primary/20 bg-gradient-to-br from-card to-muted/20">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Award className="w-5 h-5 text-primary" />
                        {detectedRegions.length > 0
                          ? `${detectedRegions.reduce((prev, current) =>
                            (prev.sam_score > current.sam_score) ? prev : current
                          ).region_name.replace('of the jewellery', '').trim()} (${detectedRegions.length})`
                          : `Detected Components (${detectedRegions.length})`
                        }
                      </CardTitle>
                      {selectedItemForRegions && (
                        <CardDescription className="mt-1 text-xs">
                          From Jewellery Item #{selectedItemForRegions}
                        </CardDescription>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowRegionsPanel(false);
                        setSelectedItemForRegions(null);
                      }}
                      className="h-8 w-8 p-0"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 max-h-[400px] overflow-y-auto pr-2">
                    {detectedRegions.map((region, index) => (
                      <div
                        key={index}
                        className="group border rounded-lg p-3 bg-card hover:shadow-lg hover:border-primary/40 transition-all duration-200"
                      >
                        {/* Thumbnail */}
                        <div className="aspect-square rounded-md overflow-hidden bg-muted mb-2 border border-border">
                          <img
                            src={region.image}
                            alt={region.region_name}
                            className="w-full h-full object-contain transform group-hover:scale-105 transition-transform duration-200"
                          />
                        </div>

                        {/* Component Info */}
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-foreground text-center" title={region.region_name}>
                            {region.region_name.replace('of the jewellery', '').trim()}
                          </p>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-success font-semibold">{region.confidence}%</span>
                            <span className="text-muted-foreground">SAM: {region.sam_score.toFixed(3)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Summary Footer */}
                  <div className="mt-4 pt-3 border-t flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Total components detected: <strong className="text-foreground">{detectedRegions.length}</strong>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowRegionsPanel(false);
                        setSelectedItemForRegions(null);
                      }}
                    >
                      Close
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Footer Navigation - Always Visible */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-md border-t z-40">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => navigate('/customer-image')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>

            <div className="hidden md:flex items-center gap-6 text-sm">
              {gpsLoading ? (
                <span className="flex items-center text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin mr-2" />Locating...</span>
              ) : gpsData ? (
                <span className="flex items-center font-medium text-primary">
                  <MapPin className="w-3 h-3 mr-1" /> {gpsData.latitude.toFixed(4)}, {gpsData.longitude.toFixed(4)}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-semibold text-primary/80">
                  {canProceed() ? "Ready to Proceed" : "Steps Incomplete"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {overallImages.length > 0 ? "Overall images captured" :
                    capturedItems.length === totalItems ? "All items captured" : "Capture required"}
                </p>
              </div>
              <Button
                size="lg"
                onClick={handleNext}
                disabled={isLoading || !canProceed()}
                className={cn(canProceed() ? "animate-pulse shadow-lg shadow-primary/20" : "")}
              >
                {isLoading ? "Saving..." : "Next Step"} <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ModernDashboardLayout>
  );
}

export default RBICompliance;
