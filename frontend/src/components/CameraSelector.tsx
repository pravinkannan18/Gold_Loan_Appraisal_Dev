import { useState, useEffect } from 'react';
import { Camera, Video, RefreshCw, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CameraDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

interface CameraSelectorProps {
  onCameraSelect: (deviceId: string) => void;
  selectedDeviceId?: string;
  className?: string;
  autoDetect?: boolean;
}

export function CameraSelector({
  onCameraSelect,
  selectedDeviceId,
  className = '',
  autoDetect = true
}: CameraSelectorProps) {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);

  const detectCameras = async () => {
    setIsDetecting(true);
    try {
      // Request camera permission first
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      setHasPermission(true);

      // Enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');

      const cameraList: CameraDevice[] = videoDevices.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
        groupId: device.groupId
      }));

      setCameras(cameraList);

      console.log('📹 Available Cameras:', cameraList.length);
      cameraList.forEach((cam, idx) => {
        console.log(`  [${idx + 1}] ${cam.label} (ID: ${cam.deviceId})`);
      });

      // Auto-select first camera if autoDetect is enabled
      if (autoDetect && cameraList.length > 0 && !selectedDeviceId) {
        onCameraSelect(cameraList[0].deviceId);
      }

    } catch (error: any) {
      console.error('Camera detection error:', error);
      setHasPermission(false);
      setCameras([]);
    } finally {
      setIsDetecting(false);
    }
  };

  useEffect(() => {
    if (autoDetect) {
      detectCameras();
    }
  }, [autoDetect]);

  if (!hasPermission && cameras.length === 0) {
    return (
      <div className={cn("rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800", className)}>
        <div className="flex items-center gap-3 mb-3">
          <Video className="h-5 w-5 text-gray-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Camera Selection</h3>
        </div>
        <button
          onClick={detectCameras}
          disabled={isDetecting}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDetecting ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Detecting Cameras...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" />
              Detect Cameras
            </>
          )}
        </button>
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <div className={cn("rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20", className)}>
        <div className="flex items-center gap-3 mb-2">
          <Camera className="h-5 w-5 text-red-600 dark:text-red-400" />
          <h3 className="font-semibold text-red-900 dark:text-red-100">No Cameras Detected</h3>
        </div>
        <p className="text-sm text-red-700 dark:text-red-300 mb-3">
          Please connect a camera and try again
        </p>
        <button
          onClick={detectCameras}
          disabled={isDetecting}
          className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", isDetecting && "animate-spin")} />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800", className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Video className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Camera Selection ({cameras.length} found)
          </h3>
        </div>
        <button
          onClick={detectCameras}
          disabled={isDetecting}
          className="flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          <RefreshCw className={cn("h-3 w-3", isDetecting && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="space-y-2">
        {cameras.map((camera, index) => (
          <button
            key={camera.deviceId}
            onClick={() => onCameraSelect(camera.deviceId)}
            className={cn(
              "w-full flex items-center gap-3 rounded-md border p-3 text-left transition-all",
              selectedDeviceId === camera.deviceId
                ? "border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20"
                : "border-gray-200 bg-white hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700"
            )}
          >
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              selectedDeviceId === camera.deviceId
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
            )}>
              {selectedDeviceId === camera.deviceId ? (
                <Check className="h-4 w-4" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </div>
            <div className="flex-1">
              <p className={cn(
                "font-medium",
                selectedDeviceId === camera.deviceId
                  ? "text-blue-900 dark:text-blue-100"
                  : "text-gray-900 dark:text-white"
              )}>
                {camera.label}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Camera {index + 1}
              </p>
            </div>
          </button>
        ))}
      </div>

      {cameras.length > 1 && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-blue-50 p-2 dark:bg-blue-900/20">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-800">
            <span className="text-xs font-bold text-blue-600 dark:text-blue-400">💡</span>
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Multiple cameras detected! Select the one you want to use.
          </p>
        </div>
      )}
    </div>
  );
}
