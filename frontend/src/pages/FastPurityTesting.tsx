/**
 * Fast Purity Testing Component
 * Real-time YOLO predictions via WebSocket with backend camera
 */
import { useState, useEffect } from 'react';
import { useFastPurity, getAvailableCameras } from '../hooks/useFastPurity';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Play, Square, RefreshCw, Camera, Wifi, WifiOff, Zap, Clock } from 'lucide-react';
import { showToast } from '../lib/utils';

interface CameraInfo {
  index: number;
  name: string;
  resolution: string;
}

export function FastPurityTesting() {
  const {
    connected,
    running,
    frame,
    status,
    fps,
    processMs,
    error,
    start,
    stop,
    reset,
  } = useFastPurity();

  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('0');
  const [loading, setLoading] = useState(false);

  // Load available cameras
  useEffect(() => {
    const loadCameras = async () => {
      try {
        const data = await getAvailableCameras();
        setCameras(data.cameras || []);
        if (data.current !== null) {
          setSelectedCamera(String(data.current));
        }
      } catch (e) {
        console.error('Failed to load cameras:', e);
      }
    };
    loadCameras();
  }, []);

  // Show toast on detection
  useEffect(() => {
    if (status?.rubbing_detected && status.task === 'acid') {
      showToast('✅ Rubbing Test Completed!', 'success');
    }
    if (status?.acid_detected && status.task === 'done') {
      showToast('✅ Acid Test Completed! Purity verified.', 'success');
    }
  }, [status?.rubbing_detected, status?.acid_detected, status?.task]);

  const handleStart = () => {
    setLoading(true);
    start(parseInt(selectedCamera));
    setTimeout(() => setLoading(false), 500);
  };

  const handleStop = () => {
    stop();
  };

  const handleReset = () => {
    reset();
    showToast('Detection reset', 'info');
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Fast Purity Testing</h1>
            <p className="text-muted-foreground">Real-time YOLO detection via WebSocket</p>
          </div>
          
          {/* Connection Status */}
          <Badge variant={connected ? 'default' : 'destructive'} className="gap-1">
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Controls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Camera Control</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 flex-wrap">
              {/* Camera Selection */}
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <Select 
                  value={selectedCamera} 
                  onValueChange={setSelectedCamera}
                  disabled={running}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Select Camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {cameras.length === 0 ? (
                      <SelectItem value="0">Camera 0</SelectItem>
                    ) : (
                      cameras.map((cam) => (
                        <SelectItem key={cam.index} value={String(cam.index)}>
                          {cam.name} ({cam.resolution})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Start/Stop Button */}
              {!running ? (
                <Button 
                  onClick={handleStart} 
                  disabled={!connected || loading}
                  className="gap-2"
                >
                  <Play className="w-4 h-4" />
                  Start Analysis
                </Button>
              ) : (
                <Button 
                  onClick={handleStop}
                  variant="destructive"
                  className="gap-2"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </Button>
              )}

              {/* Reset Button */}
              <Button 
                onClick={handleReset}
                variant="outline"
                disabled={!running}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Video Display */}
        <Card className="overflow-hidden">
          <CardContent className="p-0 relative">
            {frame ? (
              <img 
                src={frame} 
                alt="YOLO Detection" 
                className="w-full aspect-video object-contain bg-black"
              />
            ) : (
              <div className="w-full aspect-video bg-muted flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>{running ? 'Loading stream...' : 'Camera not started'}</p>
                </div>
              </div>
            )}

            {/* Performance Overlay */}
            {running && (
              <div className="absolute top-2 right-2 bg-black/70 text-white px-3 py-1 rounded-lg text-sm flex gap-4">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  {fps.toFixed(1)} FPS
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-blue-400" />
                  {processMs.toFixed(0)} ms
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Display */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Detection Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {/* Current Stage */}
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Current Stage</p>
                <Badge 
                  variant={status?.task === 'done' ? 'default' : 'secondary'}
                  className="text-lg px-4 py-1"
                >
                  {status?.task === 'rubbing' && '🔄 Stage 1: Rubbing Test'}
                  {status?.task === 'acid' && '🧪 Stage 2: Acid Test'}
                  {status?.task === 'done' && '✅ Complete'}
                  {!status && '⏳ Waiting...'}
                </Badge>
              </div>

              {/* Detection Results */}
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Results</p>
                <div className="flex gap-2">
                  <Badge variant={status?.rubbing_detected ? 'default' : 'outline'}>
                    {status?.rubbing_detected ? '✓' : '○'} Rubbing
                  </Badge>
                  <Badge variant={status?.acid_detected ? 'default' : 'outline'}>
                    {status?.acid_detected ? '✓' : '○'} Acid
                  </Badge>
                </div>
              </div>

              {/* Message */}
              {status?.message && (
                <div className="col-span-2 mt-2">
                  <p className="text-sm text-muted-foreground">Message</p>
                  <p className="font-medium">{status.message}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Performance Info */}
        <div className="text-center text-sm text-muted-foreground">
          <p>
            Backend camera with GPU-accelerated YOLO inference.
            WebSocket streaming for minimal latency.
          </p>
        </div>
      </div>
    </div>
  );
}

export default FastPurityTesting;
