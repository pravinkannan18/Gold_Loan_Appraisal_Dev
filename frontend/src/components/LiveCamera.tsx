import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "@/hooks/use-toast";

interface LiveCameraProps {
  onCapture: (imageDataUrl: string) => void;
  onClose?: () => void;
  currentStepKey: number;   // New: current step key from StepIndicator
  selectedDeviceId?: string; // Manual camera selection
}

export interface LiveCameraRef {
  capturePhoto: () => Promise<void>;
  stopCamera: () => void;
}

const LiveCamera = forwardRef<LiveCameraRef, LiveCameraProps>((props, ref) => {
  const { onCapture, onClose, currentStepKey, selectedDeviceId } = props;  // Receive step key and device ID

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");

  useEffect(() => {
    const getCamerasAndSelect = async () => {
      try {
        // First, request camera permission to get accurate device labels
        let permissionStream: MediaStream | null = null;
        try {
          permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (permError) {
          console.warn("Camera permission not granted yet:", permError);
          // Continue anyway - enumerateDevices will show devices without labels
        }

        // Now enumerate devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === "videoinput");
        
        // Stop the permission stream immediately
        if (permissionStream) {
          permissionStream.getTracks().forEach(track => track.stop());
        }

        setDevices(videoDevices);
        console.log("Available video devices:", videoDevices);
        console.log("Total cameras found:", videoDevices.length);
        videoDevices.forEach((dev, idx) => {
          console.log(`Camera ${idx + 1}: ${dev.label || 'Unnamed'} (ID: ${dev.deviceId})`);
        });

        // Map StepIndicator keys to desired camera index/deviceId
        if (videoDevices.length > 0) {
          let targetDeviceId: string | undefined = undefined;
          let targetIndex: number = -1;

          // Priority: 1. selectedDeviceId prop, 2. step-based mapping, 3. fallback
          if (selectedDeviceId) {
            targetDeviceId = selectedDeviceId;
            console.log(`Using manually selected camera: ${targetDeviceId}`);
          } else {
            // Set your known device IDs for each step key
            if (currentStepKey === 2) {
              targetDeviceId = 'd71d64e11e05c2988940b827afec7d177181ba8a5ba2791cc34ebb438fa43d8f';
            } else if (currentStepKey === 3) {
              targetDeviceId = '686ba1f1435a79b8ddd2cabaa0223d9afd85cf1aa82bb9ec3f069e3ac41df0e8';
            } else if (currentStepKey === 4) {
              targetDeviceId = '686ba1f1435a79b8ddd2cabaa0223d9afd85cf1aa82bb9ec3f069e3ac41df0e8';
            }
          }

          if (targetDeviceId) {
            targetIndex = videoDevices.findIndex(device => device.deviceId === targetDeviceId);
          }

          if (targetIndex !== -1) {
            console.log(`Using camera at index ${targetIndex} for step ${currentStepKey}`);
            setSelectedDevice(videoDevices[targetIndex].deviceId);
          } else {
            // Fallback: use first available camera
            const fallbackIndex = Math.min(0, videoDevices.length - 1);
            console.log(`Device ID not found, using fallback camera at index ${fallbackIndex}`);
            setSelectedDevice(videoDevices[fallbackIndex].deviceId);
          }
        } else {
          setError("No cameras detected. Please connect a camera and refresh.");
        }
      } catch (error: any) {
        console.error("Error enumerating devices:", error);
        setError(`Failed to access cameras: ${error.message || 'Unknown error'}`);
        toast({ 
          title: "Camera Error", 
          description: "Failed to list cameras. Please check camera permissions.", 
          variant: "destructive" 
        });
      }
    };
    getCamerasAndSelect();

    return () => stopCamera();
  }, [currentStepKey, selectedDeviceId]);  // Re-run if step or device changes

  const startCamera = async (deviceId?: string, retryCount: number = 0) => {
    try {
      setError(null);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API not supported in this browser");
      }
      
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        // Wait a bit for the camera to be released
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      const constraints: MediaStreamConstraints = {
        video: deviceId 
          ? { 
              deviceId: { exact: deviceId },
              width: { ideal: 3840, min: 1280 },
              height: { ideal: 2160, min: 720 },
              aspectRatio: { ideal: 16/9 }
            } 
          : {
              width: { ideal: 3840, min: 1280 },
              height: { ideal: 2160, min: 720 },
              aspectRatio: { ideal: 16/9 }
            },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        await new Promise<void>((resolve, reject) => {
          if (!videoRef.current) return reject("No video element");
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().then(resolve).catch(reject);
          };
          videoRef.current.onerror = () => reject("Playback error");
        });
        setIsStreaming(true);
        toast({ title: "Camera Started", description: "Live camera feed is now active" });
      }
    } catch (err: any) {
      let message = "Unable to access camera.";
      
      if (err.name === 'NotAllowedError') {
        message = "Camera permission denied. Please allow camera access in browser settings.";
      } else if (err.name === 'NotFoundError') {
        message = "No camera found. Please connect a camera and try again.";
      } else if (err.name === 'NotReadableError') {
        message = "Camera is already in use. Please close other apps using this camera (Teams, Zoom, etc.) or try a different camera.";
        // Retry with a different camera if available
        if (retryCount < 2 && devices.length > 1) {
          const currentIndex = devices.findIndex(d => d.deviceId === deviceId);
          const nextIndex = (currentIndex + 1) % devices.length;
          const nextDevice = devices[nextIndex];
          console.log(`Camera busy, trying next camera: ${nextDevice.label}`);
          toast({ title: "Camera Busy", description: `Trying ${nextDevice.label || 'another camera'}...` });
          setTimeout(() => startCamera(nextDevice.deviceId, retryCount + 1), 500);
          return;
        }
      } else if (err.name === 'OverconstrainedError') {
        message = "Selected camera doesn't meet the requirements. Trying default camera...";
        // Retry with default camera
        if (deviceId) {
          setTimeout(() => startCamera(), 500);
          return;
        }
      } else if (err.message) {
        message = err.message;
      }
      
      console.error("Camera error:", err);
      setError(message);
      toast({ title: "Camera Error", description: message, variant: "destructive" });
    }
  };

  useEffect(() => {
    if (selectedDevice) startCamera(selectedDevice);
  }, [selectedDevice]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setError(null);
    toast({ title: "Camera Stopped", description: "Camera has been turned off" });
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current || !isStreaming) {
      toast({ title: "Error", description: "Camera not ready", variant: "destructive" });
      return;
    }
    try {
      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (video.readyState === video.HAVE_ENOUGH_DATA) resolve();
            else requestAnimationFrame(check);
          };
          check();
        });
      }
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context missing");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 1.0);
      onCapture(dataUrl);
      toast({ title: "Success", description: "Image captured successfully" });
    } catch {
      toast({ title: "Error", description: "Failed to capture image", variant: "destructive" });
    }
  };

  useImperativeHandle(ref, () => ({
    capturePhoto,
    stopCamera,
  }));

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <X className="h-4 w-4" />
          <AlertTitle>Camera Error</AlertTitle>
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}
      {/* No manual device selector UI */}
      <div className="relative rounded-lg overflow-hidden bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg" style={{ maxHeight: "600px", objectFit: "contain" }} />
        {isStreaming && (
          <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-500 text-white px-3 py-1 rounded-full text-sm font-semibold animate-pulse">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
            LIVE
          </div>
        )}
        {isStreaming && videoRef.current && (
          <div className="absolute top-4 right-4 bg-black/50 text-white px-3 py-1 rounded-md text-xs">
            {videoRef.current.videoWidth} × {videoRef.current.videoHeight}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
});

LiveCamera.displayName = "LiveCamera";
export default LiveCamera;
