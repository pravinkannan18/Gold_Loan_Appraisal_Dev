import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ImageIcon, ArrowLeft, ArrowRight } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { apiService } from '../services/api';
import { generateAppraiserId, showToast } from '../lib/utils';
import { useCameraDetection } from '../hooks/useCameraDetection';
import { AuroraLayout } from '../components/layouts/AuroraLayout';

export function AppraiserDetails() {
  const navigate = useNavigate();
  const cameraRef = useRef<LiveCameraHandle>(null);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  const { getCameraForPage } = useCameraDetection();

  // Auto-load saved camera
  useEffect(() => {
    const savedCamera = getCameraForPage('appraiser-identification');
    if (savedCamera) {
      setSelectedCameraId(savedCamera.deviceId);
    }
  }, [getCameraForPage]);

  // Check for captured photo from facial recognition
  useEffect(() => {
    const savedPhoto = localStorage.getItem('newAppraiserPhoto');
    if (savedPhoto) {
      setPhoto(savedPhoto);
      // Clear the saved photo so it doesn't persist
      localStorage.removeItem('newAppraiserPhoto');
      showToast('Photo captured from facial recognition. Please provide your details.', 'info');
    }
  }, []);

  const handleOpenCamera = () => {
    setCameraError('');
    setIsCameraReady(false);
    cameraRef.current?.openCamera();
    setIsCameraOpen(true);
  };

  const handleCloseCamera = () => {
    cameraRef.current?.closeCamera();
    setIsCameraOpen(false);
    setIsCameraReady(false);
  };

  const handleCapture = () => {
    if (!isCameraReady) {
      showToast('Camera is still starting. Please wait until the preview is ready.', 'info');
      return;
    }
    const imageData = cameraRef.current?.captureImage();
    if (imageData && imageData !== 'data:,' && imageData.length > 100) {
      setPhoto(imageData);
      cameraRef.current?.closeCamera();
      setIsCameraOpen(false);
      showToast('Photo captured successfully!', 'success');
    } else {
      showToast('Failed to capture photo. Please wait for camera to fully load and try again.', 'error');
    }
  };

  const handleRetake = () => {
    setPhoto('');
    handleOpenCamera();
  };

  const handleNext = async () => {
    if (!name.trim()) {
      showToast('Please enter appraiser name', 'error');
      return;
    }

    if (!photo) {
      showToast('Please capture appraiser photo', 'error');
      return;
    }

    // Validate photo data
    if (photo === 'data:,' || photo.length < 100) {
      showToast('Invalid photo data. Please retake the photo.', 'error');
      setPhoto('');
      return;
    }

    setIsLoading(true);

    try {
      const appraiserId = generateAppraiserId();
      const timestamp = new Date().toISOString();

      console.log('=== SAVING APPRAISER ===');
      console.log('Name:', name.trim());
      console.log('Appraiser ID:', appraiserId);
      console.log('Photo length:', photo.length);
      console.log('Timestamp:', timestamp);

      // Call backend API to save appraiser
      const response = await apiService.saveAppraiser({
        name: name.trim(),
        id: appraiserId,
        image: photo,
        timestamp: timestamp,
      });

      console.log('=== BACKEND RESPONSE ===');
      console.log('Response:', response);
      console.log('Database ID:', response.id);

      // Register face encoding for future recognition
      try {
        console.log('=== REGISTERING FACE ENCODING ===');
        const faceResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/face/register`, {
          method: 'POST',
          body: (() => {
            const formData = new FormData();
            formData.append('name', name.trim());
            formData.append('appraiser_id', appraiserId);
            formData.append('image', photo);
            return formData;
          })()
        });

        const faceData = await faceResponse.json();

        if (!faceResponse.ok) {
          console.warn('Face registration failed:', faceData.message || 'Unknown error');
          showToast(`Appraiser saved but facial recognition setup failed: ${faceData.message || 'Unknown error'}`, 'info');
        } else {
          console.log('Face encoding registered successfully:', faceData);
        }
      } catch (faceError) {
        console.warn('Face registration error:', faceError);
        showToast('Appraiser saved but facial recognition setup failed. Manual login will be required.', 'info');
      }

      // Create a new session for this appraisal workflow
      console.log('=== CREATING APPRAISAL SESSION ===');
      const sessionResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!sessionResponse.ok) {
        throw new Error('Failed to create appraisal session');
      }

      const sessionData = await sessionResponse.json();
      const sessionId = sessionData.session_id;
      console.log('Session created:', sessionId);

      // Save appraiser data to session in database
      console.log('=== SAVING APPRAISER TO SESSION ===');
      const appraiserData = {
        name: name.trim(),
        id: appraiserId,
        image: photo,
        timestamp: timestamp,
        photo: photo,  // Include both for compatibility
        db_id: response.id
      };

      const saveResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/appraiser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appraiserData)
      });

      if (!saveResponse.ok) {
        throw new Error('Failed to save appraiser data to session');
      }

      console.log('Appraiser data saved to session');

      // Store ONLY the session_id in localStorage (tiny, no quota issues)
      localStorage.setItem('appraisal_session_id', sessionId);

      // Also store minimal appraiser info for quick access (no images)
      localStorage.setItem('currentAppraiser', JSON.stringify({
        id: response.id,
        appraiser_id: appraiserId,
        name: name.trim(),
        timestamp: timestamp,
        session_id: sessionId
      }));

      showToast('Appraiser details saved!', 'success');
      console.log('=== NAVIGATING TO CUSTOMER IMAGE ===');
      navigate('/customer-image');
    } catch (error: any) {
      console.error('=== ERROR SAVING APPRAISER ===');
      console.error('Error:', error);
      console.error('Error message:', error?.message);
      console.error('Error stack:', error?.stack);
      const errorMessage = error?.message || 'Failed to save appraiser details';
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FFFDF7]">
      <StepIndicator currentStep={1} />

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
                    <ImageIcon className="h-8 w-8 text-white drop-shadow-lg" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-1 w-1 rounded-full bg-white/60 animate-pulse" />
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/90">Identity Verification</p>
                  </div>
                  <h1 className="text-3xl font-bold text-white drop-shadow-2xl tracking-tight mb-1">Appraiser Image Capture</h1>
                  <div className="flex items-center gap-2 text-sm text-[hsl(158,60%,85%)]">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-0.5 backdrop-blur-sm">
                      <span className="h-1.5 w-1.5 rounded-full bg-[hsl(320,100%,83%)] animate-pulse" />
                      Step 1 of 5
                    </span>
                    <span className="text-[hsl(158,50%,80%)]">— Establish appraiser identity</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full Width Content Grid */}
          <div className="container mx-auto max-w-7xl px-8 py-10">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="space-y-6">
                {/* Premium Input Field */}
                <div className="group/input">
                  <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    Appraiser Name <span className="text-red-500 text-base">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter full name (e.g., Priya Sharma)"
                      className="w-full rounded-xl border-2 border-slate-200/80 bg-white px-4 py-3 text-base font-medium text-slate-900 shadow-sm transition-all duration-300 placeholder:text-slate-400 hover:border-blue-300 focus:border-blue-500 focus:bg-white focus:shadow-lg focus:shadow-blue-500/10 focus:ring-4 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800/50 dark:text-white dark:hover:border-blue-500 dark:focus:bg-slate-800"
                    />
                    {name && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white">
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
                    <span>This name will appear on appraisal certificates and official records.</span>
                  </p>
                </div>

                {/* Premium Photo Section */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    Appraiser Photo <span className="text-red-500 text-base">*</span>
                  </label>

                  {photo ? (
                    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="group/photo relative overflow-hidden rounded-2xl border-4 border-emerald-500/60 bg-gradient-to-br from-emerald-50 to-green-50 p-1 shadow-2xl shadow-emerald-500/30 dark:from-emerald-950/20 dark:to-green-950/20">
                        <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/20 to-transparent" />
                        <div className="relative overflow-hidden rounded-xl">
                          <img src={photo} alt="Appraiser" className="h-64 w-full object-cover transition-transform duration-500 group-hover/photo:scale-105" />
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
                    <div className="group/placeholder relative overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-blue-50/30 p-8 text-center transition-all hover:border-blue-400 hover:bg-gradient-to-br hover:from-blue-50 hover:to-indigo-50/50 dark:border-slate-700 dark:from-slate-900/50 dark:to-blue-950/30">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.05),_transparent_70%)]" />
                      <div className="relative">
                        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500/10 transition-transform duration-300 group-hover/placeholder:scale-110">
                          <Camera className="h-8 w-8 text-blue-600 dark:text-blue-400" />
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
                </div>

                {/* Premium Guidelines Card */}
                <div className="relative overflow-hidden rounded-2xl border border-blue-200/60 bg-gradient-to-br from-blue-50/80 via-indigo-50/50 to-blue-50/80 p-6 shadow-lg shadow-blue-500/5 backdrop-blur-sm dark:border-slate-700/60 dark:from-slate-900/80 dark:via-blue-950/50 dark:to-slate-900/80">
                  <div className="absolute top-0 right-0 h-32 w-32 bg-gradient-to-br from-blue-400/10 to-transparent rounded-full blur-2xl" />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 shadow-lg shadow-blue-500/30">
                        <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h2 className="text-base font-bold text-blue-900 dark:text-blue-100">Capture Guidelines</h2>
                    </div>
                    <ul className="space-y-3 text-sm text-blue-900/90 dark:text-blue-100/90">
                      <li className="flex items-start gap-3 rounded-lg bg-white/60 p-3 backdrop-blur-sm transition-all hover:bg-white/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60">
                        <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 shadow-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <span className="font-medium">Ensure a well-lit environment with the appraiser centered in frame.</span>
                      </li>
                      <li className="flex items-start gap-3 rounded-lg bg-white/60 p-3 backdrop-blur-sm transition-all hover:bg-white/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60">
                        <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 shadow-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <span className="font-medium">Avoid glare or shadows on the face; remove accessories that obscure identity.</span>
                      </li>
                      <li className="flex items-start gap-3 rounded-lg bg-white/60 p-3 backdrop-blur-sm transition-all hover:bg-white/80 dark:bg-slate-800/40 dark:hover:bg-slate-800/60">
                        <span className="mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 shadow-md">
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        </span>
                        <span className="font-medium">Review the preview before saving; retake if clarity is insufficient.</span>
                      </li>
                    </ul>
                    <div className="mt-4 flex items-start gap-3 rounded-xl border-2 border-blue-300/40 bg-white/70 p-4 shadow-sm backdrop-blur-sm dark:border-blue-700/40 dark:bg-slate-800/70">
                      <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                        This photo is securely encrypted and shared only with authorized banking workflow systems.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {/* Premium Camera Card */}
                <div className="relative overflow-hidden rounded-2xl border-2 border-blue-200/60 bg-gradient-to-br from-white/90 via-blue-50/30 to-indigo-50/20 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur-sm transition-all duration-500 hover:shadow-3xl hover:shadow-blue-500/20 dark:border-slate-700/60 dark:from-slate-900/90 dark:via-blue-950/20 dark:to-slate-900/80">
                  {/* Premium Header */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/30">
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
                          ? 'inline-flex items-center gap-1 rounded-full bg-blue-100/80 px-3 py-1 text-sm font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200'
                          : 'inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-200'
                      }
                    >
                      <span className={`h-2 w-2 rounded-full ${isCameraOpen ? 'bg-blue-500 animate-pulse' : 'bg-slate-400'}`} />
                      {isCameraOpen ? (isCameraReady ? 'Live' : 'Starting') : 'Idle'}
                    </span>
                  </div>

                  {/* Camera Selection - REMOVED */}

                  <LiveCamera
                    ref={cameraRef}
                    currentStepKey={1}
                    selectedDeviceId={selectedCameraId}
                    displayMode="inline"
                    className="mt-6"
                    onOpen={() => setIsCameraOpen(true)}
                    onClose={() => {
                      setIsCameraOpen(false);
                      setIsCameraReady(false);
                    }}
                    onReadyChange={setIsCameraReady}
                    onError={(message) => {
                      setCameraError(message);
                      showToast(message, 'error');
                    }}
                  />

                  {cameraError ? (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
                      {cameraError}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-slate-500 text-center dark:text-slate-400">
                      The live stream stays on this page—capture when the preview looks clear.
                    </p>
                  )}

                  {/* Premium Action Buttons */}
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {isCameraOpen ? (
                      <>
                        <button
                          onClick={handleCapture}
                          disabled={!isCameraReady}
                          className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-6 py-3 font-bold text-white shadow-xl shadow-blue-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-700 opacity-0 transition-opacity group-hover/btn:opacity-100" />
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
                        className="group/btn relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-6 py-3 font-bold text-white shadow-xl shadow-blue-500/40 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/60"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-700 via-indigo-700 to-purple-700 opacity-0 transition-opacity group-hover/btn:opacity-100" />
                        <span className="relative flex items-center gap-2">
                          <Camera className="h-5 w-5 transition-transform group-hover/btn:rotate-12" />
                          Open Camera
                        </span>
                      </button>
                    )}
                  </div>
                  {!cameraError && (
                    <div className="mt-4 space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-900/80 dark:border-slate-800 dark:bg-slate-900/60 dark:text-blue-100/80">
                      <p className="font-semibold">Trouble starting the camera?</p>
                      <ul className="list-disc space-y-1 pl-5">
                        <li>Ensure you have granted browser permission to use the camera.</li>
                        <li>Close other applications that might be using the webcam.</li>
                        <li>Refresh the page if the preview remains blank.</li>
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200/70 bg-slate-50/70 px-6 py-6 dark:border-slate-800/70 dark:bg-slate-900/80">
            <div className="flex flex-col items-center justify-center gap-4 md:flex-row md:gap-6">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 rounded-xl bg-white/90 px-6 py-3 font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 transition-all hover:-translate-y-0.5 hover:shadow-lg dark:bg-slate-900/60 dark:text-slate-200 dark:ring-slate-700"
              >
                <ArrowLeft className="h-5 w-5" />
                Back to Dashboard
              </button>
              <button
                onClick={handleNext}
                disabled={isLoading}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#09543D] to-[#0a6b4d] px-6 py-3 font-semibold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoading ? 'Saving...' : 'Next Step'}
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
