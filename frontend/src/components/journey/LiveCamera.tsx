import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { Camera, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LiveCameraHandle {
  openCamera: () => void;
  closeCamera: () => void;
  captureImage: () => string | null;
  isOpen: () => boolean;
}

interface LiveCameraProps {
  onCapture?: (imageData: string) => void;
  className?: string;
  displayMode?: 'modal' | 'inline';
  onOpen?: () => void;
  onClose?: () => void;
  onReadyChange?: (ready: boolean) => void;
  onError?: (message: string) => void;
  currentStepKey?: number;
  selectedDeviceId?: string; // New prop for manual camera selection
}

export const LiveCamera = forwardRef<LiveCameraHandle, LiveCameraProps>(
  ({ 
    onCapture, 
    className = '', 
    displayMode = 'modal', 
    onOpen, 
    onClose, 
    onReadyChange, 
    onError,
    currentStepKey,
    selectedDeviceId // Accept the new prop
  }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [error, setError] = useState<string>('');

    const reportError = (message: string) => {
      console.error(message);
      setError(message);
      onError?.(message);
    };
    const openCamera = async () => {
  try {
    setError('');
    setIsOpen(true); // Set video & UI ready state before requesting permissions
    onOpen?.();
    onReadyChange?.(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      reportError('Camera access is not supported in this browser.');
      setIsOpen(false);
      setIsLoading(false);
      onReadyChange?.(false);
      onClose?.();
      return;
    }

    // Map your step key to the unique device IDs here
    const stepKeyToDeviceId: Record<number, string> = {
      1: 'd71d64e11e05c2988940b827afec7d177181ba8a5ba2791cc34ebb438fa43d8f',
      2: '04485f72abbf7f8c93fb9cdc4487eb76e4a346234aae4d38113b57f5649d4e76',
      3: 'b1c073c36c44d738600c14024878b9cb207636329e895190572b0bbd4a21e79d',
      4: '686ba1f1435a79b8ddd2cabaa0223d9afd85cf1aa82bb9ec3f069e3ac41df0e8',
      5: '686ba1f1435a79b8ddd2cabaa0223d9afd85cf1aa82bb9ec3f069e3ac41df0e8',
    };

    let deviceIdToUse: string | undefined;
    
    // Priority: 1. selectedDeviceId prop, 2. step-based mapping, 3. default
    if (selectedDeviceId) {
      deviceIdToUse = selectedDeviceId;
      console.log(`Using manually selected camera: ${deviceIdToUse}`);
    } else if (currentStepKey) {
      deviceIdToUse = stepKeyToDeviceId[currentStepKey];
      console.log(`Using step-based camera for step ${currentStepKey}: ${deviceIdToUse}`);
    }

    setIsLoading(true);
    setIsVideoReady(false);

    // Enumerate devices to confirm device available
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === "videoinput");
      
      console.log(`Found ${videoDevices.length} camera(s)`);
      videoDevices.forEach((dev, idx) => {
        console.log(`Camera ${idx + 1}: ${dev.label || 'Unnamed'} (ID: ${dev.deviceId})`);
      });

      if (videoDevices.length === 0) {
        throw new Error('No cameras detected. Please connect a camera and try again.');
      }

      const deviceExists = videoDevices.find(d => d.deviceId === deviceIdToUse);
      if (!deviceExists && deviceIdToUse) {
        console.warn(`Requested camera ID not found, using fallback`);
        // Try to use the last camera (often external USB camera)
        deviceIdToUse = videoDevices[videoDevices.length - 1]?.deviceId;
      }
    } catch (enumError) {
      console.warn('Device enumeration failed:', enumError);
      // Continue with default camera
      deviceIdToUse = undefined;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceIdToUse ? { deviceId: { exact: deviceIdToUse } } : { facingMode: 'user' },
      audio: false,
    });

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;

      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          console.log('Camera video playing');
        }).catch((error) => {
          console.error('Error playing video:', error);
          reportError('Failed to start video playback');
          setIsLoading(false);
        });
      }
    }
  } catch (err: any) {
    console.error('Camera error:', err);
    let errorMessage = 'Failed to access camera';
    
    if (err.name === 'NotAllowedError') {
      errorMessage = 'Camera permission denied. Please allow camera access in your browser settings and try again.';
    } else if (err.name === 'NotFoundError') {
      errorMessage = 'No camera found on this device. Please connect a camera and refresh the page.';
    } else if (err.name === 'NotReadableError') {
      errorMessage = 'Camera is already in use by another application. Please close other apps using the camera.';
    } else if (err.name === 'OverconstrainedError') {
      errorMessage = 'Selected camera does not support required settings. Trying default camera...';
    } else if (err.message) {
      errorMessage = err.message;
    }
    
    reportError(errorMessage);
    setIsLoading(false);
    setIsVideoReady(false);
    onReadyChange?.(false);
    setIsOpen(false);
    onClose?.();
  }
};

    const closeCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      setIsOpen(false);
      setIsLoading(false);
      setIsVideoReady(false);
      onReadyChange?.(false);
      setError('');
      onClose?.();
    };

    const captureImage = (): string | null => {
      console.log('Capture attempt - isOpen:', isOpen, 'isVideoReady:', isVideoReady);
      
      if (!videoRef.current || !isOpen) {
        console.error('Video not ready or camera not open');
        return null;
      }

      const video = videoRef.current;
      
      // Check if video has valid dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.error('Video dimensions not ready:', video.videoWidth, 'x', video.videoHeight);
        console.error('Video readyState:', video.readyState);
        console.error('Video paused:', video.paused);
        return null;
      }

      console.log('Capturing image with dimensions:', video.videoWidth, 'x', video.videoHeight);

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('Failed to get canvas context');
        return null;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL('image/jpeg', 0.9);

      // Validate the captured image
      if (!imageData || imageData === 'data:,' || imageData.length < 100) {
        console.error('Invalid image data captured, length:', imageData?.length);
        return null;
      }

      console.log('Image captured successfully, size:', imageData.length, 'bytes');

      if (onCapture) {
        onCapture(imageData);
      }

      return imageData;
    };

    useImperativeHandle(ref, () => ({
      openCamera,
      closeCamera,
      captureImage,
      isOpen: () => isOpen,
    }));

    useEffect(() => {
      return () => {
        closeCamera();
      };
    }, []);

    const isInline = displayMode === 'inline';

    if (!isInline && !isOpen) return null;

    const videoElement = (
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        onLoadedMetadata={(e) => {
          const video = e.currentTarget;
          console.log('Video metadata loaded - dimensions:', video.videoWidth, 'x', video.videoHeight);
        }}
        onCanPlay={(e) => {
          const video = e.currentTarget;
          console.log('Video can play - dimensions:', video.videoWidth, 'x', video.videoHeight);
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            console.log('✓ Video is ready for capture');
            setIsVideoReady((prev) => {
              if (!prev) {
                onReadyChange?.(true);
              }
              return true;
            });
            setIsLoading(false);
          }
        }}
        onPlaying={(e) => {
          const video = e.currentTarget;
          console.log('Video playing - dimensions:', video.videoWidth, 'x', video.videoHeight);
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setIsVideoReady((prev) => {
              if (!prev) {
                onReadyChange?.(true);
              }
              return true;
            });
            setIsLoading(false);
          }
        }}
        onError={(e) => {
          console.error('Video error:', e);
          setError('Video playback error');
          setIsLoading(false);
        }}
      />
    );

    const loadingOverlay = isLoading ? (
      <div className="absolute inset-0 flex items-center justify-center bg-black/70">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mx-auto mb-4"></div>
          <p className="text-white">Starting camera...</p>
        </div>
      </div>
    ) : null;

    const readyBadge = isVideoReady && !isLoading ? (
      <div className="absolute top-4 right-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-2">
        <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
        Ready to Capture
      </div>
    ) : null;

    const errorOverlay = error ? (
      <div className="absolute inset-0 flex items-center justify-center bg-black/70">
        <p className="text-red-400 text-center px-4">{error}</p>
      </div>
    ) : null;

    if (isInline) {
      return (
        <div className={cn('relative w-full', className)}>
          <div
            className={cn(
              'relative w-full overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800/70 bg-slate-950/60',
              isOpen ? 'aspect-video' : 'min-h-[260px]'
            )}
          >
            {isOpen ? (
              <>
                <div className="absolute inset-0">{videoElement}</div>
                {loadingOverlay}
                {readyBadge}
                {errorOverlay}
                <button
                  onClick={closeCamera}
                  className="absolute top-3 right-3 rounded-full bg-black/50 p-2 text-white shadow-lg transition hover:bg-black/70"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-500 dark:text-slate-300">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-300">
                  <Camera className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-semibold text-slate-600 dark:text-slate-200">Camera is idle</p>
                  <p>Click “Open Camera” to start a live preview.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm ${className}`}>
        <div className="relative w-full max-w-4xl mx-4">
          <div className="bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-700">
            <div className="flex items-center justify-between p-4 bg-gradient-to-r from-yellow-500 to-amber-600">
              <div className="flex items-center gap-2">
                <Camera className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Live Camera</h2>
              </div>
              <button
                onClick={closeCamera}
                className="p-2 rounded-full hover:bg-white/20 transition-colors"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>

            <div className="relative aspect-video bg-black">
              {videoElement}
              {loadingOverlay}
              {readyBadge}
              {errorOverlay}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

LiveCamera.displayName = 'LiveCamera';
