import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ImageIcon, ArrowLeft, ArrowRight } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { CameraSelector } from '../components/CameraSelector';
import { apiService } from '../services/api';
import { generateAppraiserId, showToast } from '../lib/utils';

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

      // Call backend API instead of Supabase
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
          showToast('Appraiser details saved with facial recognition!', 'success');
        }
      } catch (faceError) {
        console.warn('Face registration error:', faceError);
        showToast('Appraiser saved but facial recognition setup failed. Manual login will be required.', 'info');
      }

      console.log('=== BACKEND RESPONSE ===');
      console.log('Response:', response);
      console.log('Database ID:', response.id);

      // Store appraiser data in localStorage for next steps
      const appraiserData = {
        id: response.id,
        appraiser_id: appraiserId,
        name: name.trim(),
        photo: photo,
        timestamp: timestamp,
      };
      
      console.log('=== STORING IN LOCALSTORAGE ===');
      console.log('Data to store:', appraiserData);
      
      localStorage.setItem('currentAppraiser', JSON.stringify(appraiserData));
      
      // Verify it was stored
      const stored = localStorage.getItem('currentAppraiser');
      console.log('=== VERIFICATION ===');
      console.log('Stored data:', stored);
      console.log('Parsed back:', JSON.parse(stored || '{}'));

      // Default success message - may be overridden by face registration
      let successMessage = 'Appraiser details saved!';
      
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
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.15),_transparent_45%),_radial-gradient(circle_at_bottom,_rgba(14,165,233,0.15),_transparent_55%)]">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50/70 via-white to-indigo-50/80 dark:from-slate-900 dark:via-slate-950 dark:to-blue-950 opacity-90" />
      <div className="relative z-10">
        <StepIndicator currentStep={1} />

        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="overflow-hidden rounded-3xl border border-white/40 bg-white/85 shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/70">
            <div className="bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-700 px-8 py-7">
              <div className="flex flex-wrap items-center gap-4">
                <div className="rounded-2xl bg-white/20 p-3 shadow-lg shadow-blue-900/20">
                  <ImageIcon className="h-9 w-9 text-white" />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-blue-100/80">Verification</p>
                  <h1 className="text-3xl font-semibold text-white drop-shadow-md">Appraiser Image Capture</h1>
                  <p className="text-blue-100/90">Step 1 of 5 — Establish appraiser identity</p>
                </div>
              </div>
            </div>

            <div className="grid gap-10 p-10 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="space-y-6">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Appraiser Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Priya Sharma"
                    className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-base shadow-sm transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/40 dark:border-slate-700 dark:bg-slate-900/70"
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    This name will appear on appraisal certificates and records.
                  </p>
                </div>

                <div className="space-y-4">
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Appraiser Photo <span className="text-red-500">*</span>
                  </label>

                  {photo ? (
                    <div className="space-y-4">
                      <div className="relative overflow-hidden rounded-2xl border-4 border-emerald-400/70 shadow-xl shadow-emerald-500/20">
                        <img src={photo} alt="Appraiser" className="h-64 w-full object-cover" />
                      </div>
                      <button
                        onClick={handleRetake}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white transition-all shadow-lg shadow-slate-900/25 hover:-translate-y-0.5 hover:bg-slate-900"
                      >
                        <Camera className="h-5 w-5" />
                        Retake Photo
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
                      Use the live preview on the right to capture the appraiser photo.
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-blue-100/60 bg-blue-50/60 p-6 shadow-inner dark:border-slate-800/70 dark:bg-slate-900/60">
                  <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-200">Capture Guidelines</h2>
                  <ul className="space-y-3 text-sm text-blue-900/80 dark:text-blue-100/80">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                      Ensure a well-lit environment with the appraiser centered in frame.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                      Avoid glare or shadows on the face; remove accessories that obscure identity.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                      Review the preview before saving; retake if clarity is insufficient.
                    </li>
                  </ul>
                  <div className="rounded-xl border border-blue-200/60 bg-white/80 p-4 text-sm text-blue-900/70 dark:bg-slate-950/60 dark:text-blue-100/70">
                    This photo is securely stored and shared only with authorized banking workflow systems.
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl border border-blue-100/60 bg-white/70 p-6 shadow-inner dark:border-slate-800/70 dark:bg-slate-950/40">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-200">Live Camera Preview</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Start the camera to stream directly within this workspace.</p>
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

                  {/* Camera Selection */}
                  {!isCameraOpen && (
                    <div className="mt-6">
                      <CameraSelector
                        onCameraSelect={setSelectedCameraId}
                        selectedDeviceId={selectedCameraId}
                        autoDetect={true}
                      />
                    </div>
                  )}

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

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {isCameraOpen ? (
                      <>
                        <button
                          onClick={handleCapture}
                          disabled={!isCameraReady}
                          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-700 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Camera className="h-5 w-5" />
                          Capture Photo
                        </button>
                        <button
                          onClick={handleCloseCamera}
                          className="flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 font-semibold text-slate-600 transition-all hover:-translate-y-0.5 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        >
                          Close Camera
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleOpenCamera}
                        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-700 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-500/30 transition-all hover:-translate-y-0.5 hover:shadow-2xl"
                      >
                        <Camera className="h-5 w-5" />
                        Open Camera
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
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-500 to-blue-700 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-600/30 transition-all hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? 'Saving...' : 'Next Step'}
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
