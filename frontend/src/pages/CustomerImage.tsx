import {useMemo, useState, useRef, useEffect } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, ArrowRight, UserCircle, Shield, Sparkles, Eye } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { CameraSelector } from '../components/CameraSelector';
import { showToast } from '../lib/utils';

const stageToStepKey: Record<string, number> = {
  appraiser: 1,
  customer: 2,
  rbi: 3,
  purity: 4,
  summary: 5,
};

export function CustomerImage() {
  const navigate = useNavigate();
  const location = useLocation();
  const cameraRef = useRef<LiveCameraHandle>(null);
  const [frontImage, setFrontImage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;

  useEffect(() => {
    const appraiser = localStorage.getItem('currentAppraiser');
    console.log('CustomerImage - checking appraiser on mount:', appraiser);
    if (!appraiser) {
      showToast('Please complete appraiser details first', 'error');
      navigate('/appraiser-details');
    }
  }, [navigate]);

  const handleOpenCamera = () => {
    cameraRef.current?.openCamera();
    setIsCameraOpen(true);
  };

  const handleCloseCamera = () => {
    cameraRef.current?.closeCamera();
    setIsCameraOpen(false);
  };

  const handleCapture = () => {
    const imageData = cameraRef.current?.captureImage();
    if (imageData && imageData !== 'data:,' && imageData.length > 100) {
      setFrontImage(imageData);
      showToast('Customer photo captured!', 'success');
      handleCloseCamera();
    } else {
      showToast('Failed to capture photo. Please wait for camera to fully load and try again.', 'error');
    }
  };

  const handleRetake = () => {
    setFrontImage('');
    handleOpenCamera();
  };

  const handleNext = async () => {
    if (!frontImage) {
      showToast('Please capture front view photo', 'error');
      return;
    }

    setIsLoading(true);

    try {
      const appraiserDataString = localStorage.getItem('currentAppraiser');
      console.log('Appraiser data from localStorage:', appraiserDataString);
      
      if (!appraiserDataString) {
        showToast('Please complete previous steps first', 'error');
        navigate('/appraiser-details');
        return;
      }

      const appraiserData = JSON.parse(appraiserDataString);
      console.log('Parsed appraiser data:', appraiserData);

      if (!appraiserData.id && !appraiserData.appraiser_id) {
        showToast('Appraiser data incomplete. Please start from step 1.', 'error');
        navigate('/appraiser-details');
        return;
      }

      // Store customer images in localStorage for now
      // They will be saved to backend when completing the full appraisal
      localStorage.setItem('customerFrontImage', frontImage);
      localStorage.removeItem('customerSideImage');

      console.log('Customer images saved to localStorage');
      console.log('Front image length:', frontImage.length);

      showToast('Customer images saved!', 'success');
      navigate('/rbi-compliance');
    } catch (error) {
      console.error('Error saving customer images:', error);
      showToast('Failed to save customer images', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-100 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950">
      {/* Enhanced background with animated gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_800px_600px_at_50%_-200px,_rgba(99,102,241,0.15),_transparent),_radial-gradient(ellipse_600px_400px_at_80%_100%,_rgba(168,85,247,0.12),_transparent)]" />
      <div className="absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-blue-50/40 dark:from-slate-950/80 dark:via-slate-900/60 dark:to-indigo-950/80" />
      
      {/* Floating decorative elements */}
      <div className="absolute top-20 left-10 w-20 h-20 bg-gradient-to-br from-blue-400/20 to-purple-500/20 rounded-full blur-xl animate-pulse" />
      <div className="absolute top-40 right-20 w-32 h-32 bg-gradient-to-br from-indigo-400/15 to-blue-500/15 rounded-full blur-2xl animate-pulse delay-1000" />
      <div className="absolute bottom-20 left-1/4 w-24 h-24 bg-gradient-to-br from-purple-400/20 to-pink-500/20 rounded-full blur-xl animate-pulse delay-2000" />
      
      <div className="relative z-10">
        <StepIndicator currentStep={2} />

        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="overflow-hidden rounded-3xl border border-white/20 bg-white/80 backdrop-blur-2xl shadow-2xl shadow-blue-500/10 dark:border-slate-700/30 dark:bg-slate-900/70">
            {/* Enhanced header with gradient and icons */}
            <div className="relative bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-10 py-8">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600/90 via-indigo-600/90 to-purple-600/90" />
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
                    <UserCircle className="h-10 w-10 text-white" />
                    <div className="absolute -top-1 -right-1 rounded-full bg-green-400 p-1">
                      <Shield className="h-3 w-3 text-white" />
                    </div>
                  </div>
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-yellow-300" />
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-blue-100">
                      Customer Verification
                    </p>
                  </div>
                  <h1 className="text-4xl font-bold text-white drop-shadow-lg mb-2 bg-gradient-to-r from-white to-blue-100 bg-clip-text">
                    Customer Image Capture
                  </h1>
                  <p className="text-lg text-blue-100/90 font-medium">
                    Step 2 of 5 — Secure customer photo verification
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-10 p-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="space-y-10">
                {/* Enhanced section title */}
                <div className="relative">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 p-2">
                      <Camera className="h-5 w-5 text-white" />
                    </div>
                    <label className="text-lg font-bold text-slate-800 dark:text-slate-100">
                      Customer Front View Photo
                      <span className="ml-2 text-red-500 text-xl">*</span>
                    </label>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    Capture a clear, well-lit front view photo of the customer for verification purposes
                  </p>
                </div>

                {/* Enhanced camera section */}
                {frontImage ? (
                  <div className="space-y-6">
                    <div className="relative overflow-hidden rounded-3xl border-4 border-emerald-400/70 shadow-2xl shadow-emerald-500/20 bg-gradient-to-br from-emerald-50 to-green-50">
                      <div className="absolute top-4 right-4 z-10">
                        <div className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                          ✓ Captured
                        </div>
                      </div>
                      <img src={frontImage} alt="Customer Front View" className="h-80 w-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" />
                    </div>
                    <button
                      onClick={handleRetake}
                      className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 font-bold text-white transition-all shadow-xl shadow-slate-900/30 hover:-translate-y-1 hover:shadow-2xl hover:from-slate-800 hover:to-slate-900 active:translate-y-0"
                    >
                      <Camera className="h-5 w-5" />
                      Retake Photo
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleOpenCamera}
                    className="group relative flex h-80 w-full flex-col items-center justify-center gap-4 rounded-3xl border-3 border-dashed border-blue-300/60 bg-gradient-to-br from-blue-50/60 via-indigo-50/40 to-purple-50/60 text-slate-600 transition-all duration-300 hover:border-blue-400/80 hover:from-blue-100/70 hover:via-indigo-100/50 hover:to-purple-100/70 hover:shadow-xl dark:border-blue-500/40 dark:bg-slate-800/40 dark:hover:bg-slate-700/60"
                  >
                    <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-blue-400/5 via-indigo-400/5 to-purple-400/5" />
                    <div className="relative rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-4 shadow-lg group-hover:shadow-xl transition-all duration-300">
                      <Camera className="h-12 w-12 text-white" />
                    </div>
                    <div className="relative text-center">
                      <span className="block text-lg font-bold text-blue-700 group-hover:text-blue-800 dark:text-blue-300 dark:group-hover:text-blue-200">
                        Launch Camera
                      </span>
                      <span className="block text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Click to start photo capture
                      </span>
                    </div>
                  </button>
                )}

                {/* Enhanced tips section */}
                <div className="space-y-4 rounded-3xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 to-green-50/60 p-6 shadow-lg dark:border-emerald-500/30 dark:from-emerald-950/40 dark:to-green-950/30">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-lg bg-emerald-500 p-2">
                      <Shield className="h-5 w-5 text-white" />
                    </div>
                    <h2 className="text-xl font-bold text-emerald-800 dark:text-emerald-100">
                      Photography Guidelines
                    </h2>
                  </div>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="text-emerald-700 dark:text-emerald-200 leading-relaxed">
                        Ensure even lighting without harsh shadows or glare
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="text-emerald-700 dark:text-emerald-200 leading-relaxed">
                        Keep the customer centered and looking forward
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="text-emerald-700 dark:text-emerald-200 leading-relaxed">
                        Remove accessories that obscure facial features
                      </span>
                    </li>
                    <li className="flex items-start gap-3">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      <span className="text-emerald-700 dark:text-emerald-200 leading-relaxed">
                        Maintain appropriate distance for clear face capture
                      </span>
                    </li>
                  </ul>
                  <div className="mt-6 rounded-2xl border border-emerald-300/50 bg-white/90 p-4 dark:border-emerald-600/30 dark:bg-emerald-900/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                        Privacy & Security
                      </span>
                    </div>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                      All images are encrypted end-to-end and shared only with authorized banking systems in compliance with data protection regulations.
                    </p>
                  </div>
                </div>

                {frontImage && (
                  <div className="rounded-3xl border-2 border-emerald-300 bg-gradient-to-r from-emerald-100 via-green-50 to-emerald-100 p-6 text-center shadow-lg dark:border-emerald-600/50 dark:from-emerald-900/40 dark:via-green-900/30 dark:to-emerald-900/40">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <div className="rounded-full bg-emerald-500 p-1">
                        <Sparkles className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-lg font-bold text-emerald-800 dark:text-emerald-200">
                        Perfect Capture!
                      </span>
                    </div>
                    <p className="text-emerald-700 dark:text-emerald-300">
                      Photo quality looks excellent. Ready to proceed to next step.
                    </p>
                  </div>
                )}
              </div>

              {/* Enhanced sidebar */}
              <div className="space-y-8 rounded-3xl border border-blue-100/60 bg-gradient-to-br from-white/90 to-blue-50/40 p-8 shadow-xl backdrop-blur-sm dark:border-blue-500/20 dark:from-slate-800/80 dark:to-blue-900/20">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-3 mb-4">
                    <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-3">
                      <Eye className="h-6 w-6 text-white" />
                    </div>
                    <div className="text-left">
                      <h2 className="text-xl font-bold text-blue-800 dark:text-blue-100">
                        Live Preview
                      </h2>
                      <p className="text-sm text-blue-600 dark:text-blue-300">
                        Real-time camera feed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <span
                      className={
                        isCameraOpen
                          ? 'inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-green-700 shadow-lg dark:bg-green-900/40 dark:text-green-300'
                          : 'inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-500 shadow-lg dark:bg-slate-700 dark:text-slate-300'
                      }
                    >
                      <span className={`h-3 w-3 rounded-full ${isCameraOpen ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
                      {isCameraOpen ? 'Camera Active' : 'Camera Idle'}
                    </span>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-3xl border-2 border-blue-200/70 bg-gradient-to-br from-blue-50/80 to-indigo-50/60 p-6 shadow-lg dark:border-blue-500/30 dark:from-blue-950/50 dark:to-indigo-950/40">
                    <div className="flex items-center gap-3 mb-3">
                      <Camera className="h-5 w-5 text-blue-600" />
                      <span className="text-lg font-bold text-blue-800 dark:text-blue-100">
                        Capture Instructions
                      </span>
                    </div>
                    <p className="text-sm text-blue-700 dark:text-blue-200 leading-relaxed">
                      Position the customer in the center of the frame. Ensure good lighting and wait for a clear, steady shot before capturing.
                    </p>
                  </div>

                  {/* Camera Selection */}
                  {!isCameraOpen && (
                    <div className="mb-6">
                      <CameraSelector
                        onCameraSelect={setSelectedCameraId}
                        selectedDeviceId={selectedCameraId}
                        autoDetect={true}
                      />
                    </div>
                  )}

                  <LiveCamera
                    ref={cameraRef}
                    currentStepKey={currentStepKey}
                    selectedDeviceId={selectedCameraId}
                    displayMode="inline"
                    className="rounded-3xl border-4 border-blue-200/50 shadow-2xl"
                    onOpen={() => setIsCameraOpen(true)}
                    onClose={() => setIsCameraOpen(false)}
                  />

                  <div className="flex flex-wrap items-center justify-center gap-4">
                    {isCameraOpen ? (
                      <>
                        <button
                          onClick={handleCapture}
                          className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 px-8 py-4 font-bold text-white shadow-xl shadow-blue-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/40 active:translate-y-0"
                        >
                          <Camera className="h-6 w-6" />
                          Capture Photo
                        </button>
                        <button
                          onClick={handleCloseCamera}
                          className="flex items-center gap-3 rounded-2xl border-2 border-slate-300 bg-white/90 px-8 py-4 font-bold text-slate-700 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:bg-slate-50 hover:shadow-xl dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          <ArrowLeft className="h-5 w-5" />
                          Close Camera
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleOpenCamera}
                        className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 px-8 py-4 font-bold text-white shadow-xl shadow-blue-500/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/40 active:translate-y-0"
                      >
                        <Camera className="h-6 w-6" />
                        Open Camera
                      </button>
                    )}
                  </div>

                  <div className="rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:from-blue-900/30 dark:to-indigo-900/30">
                    <p className="text-center text-sm text-blue-700 dark:text-blue-300 leading-relaxed">
                      💡 <strong>Pro Tip:</strong> Keep the device steady and wait for the preview to stabilize before capturing for the best results.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Enhanced footer */}
            <div className="border-t border-blue-100/70 bg-gradient-to-r from-blue-50/80 via-indigo-50/60 to-purple-50/80 px-10 py-8 dark:border-blue-500/30 dark:from-blue-950/60 dark:via-indigo-950/50 dark:to-purple-950/60">
              <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
                <button
                  onClick={() => navigate('/appraiser-details')}
                  className="flex items-center gap-3 rounded-2xl bg-white/90 px-8 py-4 font-bold text-slate-700 shadow-lg ring-2 ring-slate-200/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-slate-300/60 dark:bg-slate-800/80 dark:text-slate-300 dark:ring-slate-600/50 dark:hover:ring-slate-500/60"
                >
                  <ArrowLeft className="h-5 w-5" />
                  Previous Step
                </button>
                
                <div className="flex items-center gap-4">
                  {frontImage && (
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                      <div className="rounded-full bg-emerald-500 p-1">
                        <Sparkles className="h-3 w-3 text-white" />
                      </div>
                      <span className="text-sm font-semibold">Ready to proceed</span>
                    </div>
                  )}
                  
                  <button
                    onClick={handleNext}
                    disabled={!frontImage || isLoading}
                    className={`flex items-center gap-3 rounded-2xl px-8 py-4 font-bold text-white shadow-xl transition-all duration-300 ${
                      frontImage && !isLoading
                        ? 'bg-gradient-to-r from-emerald-500 via-green-500 to-emerald-600 shadow-emerald-500/30 hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-600/40 active:translate-y-0'
                        : 'bg-slate-400 cursor-not-allowed shadow-slate-400/30'
                    }`}
                  >
                    {isLoading ? (
                      <>
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Processing...
                      </>
                    ) : (
                      <>
                        Continue Journey
                        <ArrowRight className="h-5 w-5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
