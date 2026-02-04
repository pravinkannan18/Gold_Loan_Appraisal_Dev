import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface CameraCaptureProps {
  onCapture: (imageDataUrl: string) => void;
  label: string;
  autoStart?: boolean;
}

export interface CameraCaptureRef {
  capturePhoto: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

const CameraCapture = forwardRef<CameraCaptureRef, CameraCaptureProps>(
  ({ onCapture, label, autoStart = true }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = async () => {
    try {
      setError(null);
      
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API is not supported in this browser. Please use a modern browser or enable camera permissions.");
      }

      // Check camera permissions
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'camera' as PermissionName });
        if (permissionStatus.state === 'denied') {
          throw new Error("Camera access denied. Please enable camera permissions in your browser settings.");
        }
      } catch (permError) {
        // Some browsers don't support permission query, continue anyway
        console.warn("Could not query camera permissions:", permError);
      }

      // Try with environment facing camera first (back camera)
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: { ideal: "environment" },
            width: { ideal: 3840, min: 1280 },
            height: { ideal: 2160, min: 720 },
            aspectRatio: { ideal: 16/9 }
          },
        });
      } catch (envError) {
        // Fallback to any available camera
        console.warn("Environment camera not available, trying default camera:", envError);
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 3840, min: 1280 },
            height: { ideal: 2160, min: 720 },
            aspectRatio: { ideal: 16/9 }
          },
        });
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsStreaming(true);
        setError(null);
      }
    } catch (error: any) {
      console.error("Error accessing camera:", error);
      let errorMessage = "Unable to access camera. ";
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage += "Camera permission was denied. Please allow camera access in your browser settings and try again.";
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage += "No camera found on this device.";
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage += "Camera is already in use by another application. Please close other apps using the camera.";
      } else if (error.name === 'SecurityError') {
        errorMessage += "Camera access requires HTTPS or localhost. Please ensure you're using a secure connection.";
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += "Please check your camera permissions and try again.";
      }
      
      setError(errorMessage);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setError(null);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const imageDataUrl = canvas.toDataURL("image/jpeg", 1.0);
        onCapture(imageDataUrl);
        stopCamera();
      }
    }
  };

  // Auto-start camera when component mounts if autoStart is true
  useEffect(() => {
    if (autoStart) {
      startCamera();
    }
    
    // Cleanup on unmount
    return () => {
      stopCamera();
    };
  }, []);

  // Expose capturePhoto and videoRef to parent component
  useImperativeHandle(ref, () => ({
    capturePhoto,
    videoRef
  }));

  return (
    <div className="space-y-4">
      {label && <label className="text-sm font-medium">{label}</label>}
      
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Camera Error</AlertTitle>
          <AlertDescription className="text-sm">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {isStreaming && (
        <div className="space-y-2">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg border border-border"
            style={{ maxHeight: "600px", objectFit: "contain" }}
          />
          <Button onClick={capturePhoto} className="w-full bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 text-white">
            <Camera className="mr-2 h-4 w-4" />
            Capture Image
          </Button>
        </div>
      )}
    </div>
  );
});

CameraCapture.displayName = "CameraCapture";

export default CameraCapture;
