import { useMemo, useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, ArrowRight, UserCircle, Shield, Sparkles, Eye } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { showToast } from '../lib/utils';
import { AuroraLayout } from '../components/layouts/AuroraLayout';

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
  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;
  // Initialize selectedCameraId from localStorage saved setting
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    const savedDeviceId = localStorage.getItem('camera_customer-image-capture');
    if (savedDeviceId) {
      console.log('📹 Loaded saved camera for customer-image-capture:', savedDeviceId);
    }
    return savedDeviceId || '';
  });

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
      // Get session ID from localStorage
      const sessionId = localStorage.getItem('appraisal_session_id');
      console.log('Session ID:', sessionId);

      if (!sessionId) {
        showToast('Session not found. Please start from appraiser details.', 'error');
        navigate('/appraiser-details');
        return;
      }

      // Save customer images to session in database
      console.log('=== SAVING CUSTOMER IMAGES TO SESSION ===');
      const saveResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          front_image: frontImage,
          side_image: null
        })
      });

      if (!saveResponse.ok) {
        throw new Error('Failed to save customer images to session');
      }

      console.log('Customer images saved to session');
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
    <div className="min-h-screen bg-[#FFFDF7]">
      <StepIndicator currentStep={2} />

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
                    <UserCircle className="h-8 w-8 text-white drop-shadow-lg" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-1 w-1 rounded-full bg-white/60 animate-pulse" />
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/90">Customer Verification</p>
                  </div>
                  <h1 className="text-3xl font-bold text-white drop-shadow-2xl tracking-tight mb-1">Customer Image Capture</h1>
                  <div className="flex items-center gap-2 text-sm text-[hsl(158,60%,85%)]">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-0.5 backdrop-blur-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-[hsl(320,100%,83%)] animate-pulse" />
                      Step 2 of 5
                    </span>
                    <span className="text-[hsl(158,50%,80%)]">— Secure customer photo verification</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full Width Content Grid */}
          <div className="container mx-auto max-w-7xl px-8 py-10">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="space-y-6">
                {/* Premium Photo Section */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Customer Front View Photo <span className="text-red-500 text-base">*</span>
                  </label>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    Capture a clear, well-lit front view photo of the customer for verification purposes
                  </p>
                </div>

                {frontImage ? (
                  <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="group/photo relative overflow-hidden rounded-2xl border-4 border-emerald-500/60 bg-gradient-to-br from-emerald-50 to-green-50 p-1 shadow-2xl shadow-emerald-500/30 dark:from-emerald-950/20 dark:to-green-950/20">
                      <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/20 to-transparent" />
                      <div className="relative overflow-hidden rounded-xl">
                        <img src={frontImage} alt="Customer" className="h-64 w-full object-cover transition-transform duration-500 group-hover/photo:scale-105" />
                        {/* Success Badge */}
                        <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 shadow-lg backdrop-blur-sm">
                          <svg className="h-4 w-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="text-xs font-bold text-white">Captured</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleRetake}
                      className="group/btn flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-3 font-bold text-white shadow-xl shadow-slate-900/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:from-slate-800 hover:to-slate-900"
                    >
                      <Camera className="h-5 w-5 transition-transform group-hover/btn:rotate-12" />
                      Retake Photo
                    </button>
                  </div>
                ) : (
                  <div className="group/placeholder relative overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-emerald-50/30 p-8 text-center transition-all hover:border-emerald-400 hover:bg-gradient-to-br hover:from-emerald-50 hover:to-green-50/50 dark:border-slate-700 dark:from-slate-900/50 dark:to-emerald-950/30">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.05),_transparent_70%)]" />
                    <div className="relative">
                      <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 transition-transform duration-300 group-hover/placeholder:scale-110">
                        <Camera className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Use the live camera preview to capture photo
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Click "Open Camera" on the right panel
                      </p>
                    </div>
                  </div>
                )}

                {/* Premium Guidelines Card */}
                <div className="relative overflow-hidden rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-emerald-50/80 via-green-50/50 to-emerald-50/80 p-6 shadow-lg shadow-emerald-500/5 backdrop-blur-sm dark:border-slate-700/60 dark:from-slate-900/80 dark:via-emerald-950/50 dark:to-slate-900/80">
                  <div className="absolute top-0 right-0 h-32 w-32 bg-gradient-to-br from-emerald-400/10 to-transparent rounded-full blur-2xl" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 shadow-lg shadow-emerald-500/30">
                        <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h2 className="text-base font-bold text-emerald-900 dark:text-emerald-100">Capture Guidelines</h2>
                    </div>
                    <ul className="space-y-3 text-sm text-emerald-900/90 dark:text-emerald-100/90">
                      <li className="flex items-start gap-3 rounded-lg bg-white/60 p-3 backdrop-blur-sm transition-all hover:bg-white/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60">
                        <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 shadow-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <span className="font-medium">Ensure even lighting without harsh shadows or glare.</span>
                      </li>
                      <li className="flex items-start gap-3 rounded-lg bg-white/60 p-3 backdrop-blur-sm transition-all hover:bg-white/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60">
                        <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 shadow-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <span className="font-medium">Keep the customer centered and looking forward.</span>
                      </li>
                      <li className="flex items-start gap-3 rounded-lg bg-white/60 p-3 backdrop-blur-sm transition-all hover:bg-white/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60">
                        <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 shadow-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <span className="font-medium">Remove accessories that obscure facial features.</span>
                      </li>
                    </ul>
                    <div className="mt-4 flex items-start gap-3 rounded-xl border-2 border-emerald-300/40 bg-white/70 p-4 shadow-sm backdrop-blur-sm dark:border-emerald-700/40 dark:bg-slate-800/70">
                      <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                        This photo is securely encrypted and shared only with authorized banking workflow systems.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {/* Premium Camera Card */}
                <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-200/60 bg-gradient-to-br from-white/90 via-emerald-50/30 to-green-50/20 p-6 shadow-2xl shadow-emerald-500/10 backdrop-blur-sm transition-all duration-500 hover:shadow-3xl hover:shadow-emerald-500/20 dark:border-slate-700/60 dark:from-slate-900/90 dark:via-emerald-950/20 dark:to-slate-900/80">
                  {/* Premium Header */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 shadow-lg shadow-emerald-500/30">
                          <Camera className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Live Camera Preview</h2>
                          <p className="text-xs text-slate-600 dark:text-slate-400">Real-time video capture workspace</p>
                        </div>
                      </div>
                    </div>
                    <span
                      className={
                        isCameraOpen
                          ? 'inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-3 py-1 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200'
                          : 'inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-200'
                      }
                    >
                      <span className={`h-2 w-2 rounded-full ${isCameraOpen ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                      {isCameraOpen ? 'Live' : 'Idle'}
                    </span>
                  </div>



                  {/* Camera Selection - REMOVED */}{/*
                    {!isCameraOpen && (
                      <div className="mt-6">
                        <PageCameraSelector
                          context="customer-image-capture"
                          label="Select Camera"
                          onCameraSelected={(camera) => setSelectedCameraId(camera?.deviceId || '')}
                        />
                      </div>
                    )}
                    */}

                  <LiveCamera
                    ref={cameraRef}
                    currentStepKey={currentStepKey}
                    selectedDeviceId={selectedCameraId}
                    displayMode="inline"
                    className="mt-6"
                    onOpen={() => setIsCameraOpen(true)}
                    onClose={() => setIsCameraOpen(false)}
                  />

                  {/* Premium Action Buttons */}
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {isCameraOpen ? (
                      <>
                        <button
                          onClick={handleCapture}
                          className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-700 px-6 py-3 font-bold text-white shadow-xl shadow-emerald-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-500/60"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-emerald-700 via-green-700 to-emerald-800 opacity-0 transition-opacity group-hover/btn:opacity-100" />
                          <span className="relative flex items-center gap-2">
                            <Camera className="h-5 w-5 transition-transform group-hover/btn:scale-110" />
                            Capture Photo
                          </span>
                        </button>
                        <button
                          onClick={handleCloseCamera}
                          className="group/btn flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-6 py-3 font-bold text-slate-700 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-slate-400 hover:bg-slate-50 hover:shadow-xl dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-700"
                        >
                          <span className="transition-transform group-hover/btn:-translate-x-0.5">←</span>
                          Close Camera
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleOpenCamera}
                        className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-700 px-6 py-3 font-bold text-white shadow-xl shadow-emerald-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-500/60"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-700 via-green-700 to-emerald-800 opacity-0 transition-opacity group-hover/btn:opacity-100" />
                        <span className="relative flex items-center gap-2">
                          <Camera className="h-5 w-5 transition-transform group-hover/btn:rotate-12" />
                          Open Camera
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Premium Footer - Full Width */}
          <div className="border-t-2 border-slate-200/60 bg-gradient-to-r from-slate-50/90 via-white/90 to-slate-50/90 backdrop-blur-sm dark:border-slate-800/60 dark:from-slate-900/90 dark:via-slate-900/95 dark:to-slate-900/90">
            <div className="container mx-auto max-w-7xl px-8 py-6">
              <div className="flex flex-col items-center justify-center gap-4 md:flex-row md:gap-6">
                <button
                  onClick={() => navigate('/appraiser-details')}
                  className="group/btn flex items-center gap-2 rounded-xl bg-white px-6 py-2.5 font-bold text-slate-700 shadow-lg ring-2 ring-slate-200 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:ring-slate-600"
                >
                  <ArrowLeft className="h-4 w-4 transition-transform group-hover/btn:-translate-x-1" />
                  Back to Previous
                </button>
                <button
                  onClick={handleNext}
                  disabled={!frontImage || isLoading}
                  className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-[#09543D] to-[#0a6b4d] px-8 py-2.5 font-bold text-white shadow-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
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
                        Continue to Next Step
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
  );
}
