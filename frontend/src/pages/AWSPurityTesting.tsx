/**
 * AWS Purity Testing Component
 * Camera runs on browser, YOLO runs on AWS GPU
 * Works when backend is hosted on AWS/cloud
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAWSPurity, getAvailableCameras, getAWSServiceStatus } from '../hooks/useAWSPurity';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { 
  Play, Square, RefreshCw, Camera, Wifi, WifiOff, 
  Zap, Clock, Cloud, ArrowLeft, Monitor 
} from 'lucide-react';
import { showToast } from '../lib/utils';

export function AWSPurityTesting() {
  const navigate = useNavigate();
  
  const {
    connected,
    streaming,
    sessionId,
    annotatedFrame,
    status,
    fps,
    processMs,
    error,
    connect,
    disconnect,
    startStreaming,
    stopStreaming,
    reset,
  } = useAWSPurity();

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [serviceStatus, setServiceStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Load available cameras and service status
  useEffect(() => {
    const init = async () => {
      try {
        const [cams, status] = await Promise.all([
          getAvailableCameras(),
          getAWSServiceStatus()
        ]);
        setCameras(cams);
        setServiceStatus(status);
        if (cams.length > 0) {
          setSelectedCamera(cams[0].deviceId);
        }
      } catch (e) {
        console.error('Init error:', e);
      }
    };
    init();
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

  const handleConnect = () => {
    setLoading(true);
    connect();
    setTimeout(() => setLoading(false), 500);
  };

  const handleStart = async () => {
    if (!connected) {
      showToast('Please connect first', 'error');
      return;
    }
    setLoading(true);
    await startStreaming(selectedCamera);
    setLoading(false);
  };

  const handleStop = () => {
    stopStreaming();
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
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate('/purity-testing')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Cloud className="w-6 h-6 text-orange-500" />
                AWS Purity Testing
              </h1>
              <p className="text-muted-foreground">
                Browser camera → AWS GPU → Real-time detection
              </p>
            </div>
          </div>
          
          {/* Connection Status */}
          <div className="flex gap-2">
            <Badge variant={connected ? 'default' : 'destructive'} className="gap-1">
              {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {connected ? 'Connected' : 'Disconnected'}
            </Badge>
            {serviceStatus && (
              <Badge variant="outline" className="gap-1">
                {serviceStatus.device === 'cuda' ? '🚀 GPU' : '💻 CPU'}
              </Badge>
            )}
          </div>
        </div>

        {/* Info Banner */}
        <Card className="bg-gradient-to-r from-orange-50 to-yellow-50 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Cloud className="w-8 h-8 text-orange-500 mt-1" />
              <div>
                <h3 className="font-semibold text-orange-900">AWS-Compatible Mode</h3>
                <p className="text-sm text-orange-700">
                  Your camera runs in the browser. Frames are sent to AWS for YOLO processing.
                  Works when backend is hosted on cloud (AWS, GCP, Azure, etc.)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error Display */}
        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Controls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Monitor className="w-5 h-5" />
              Camera Control
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 flex-wrap">
              {/* Camera Selection */}
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-muted-foreground" />
                <Select 
                  value={selectedCamera} 
                  onValueChange={setSelectedCamera}
                  disabled={streaming}
                >
                  <SelectTrigger className="w-60">
                    <SelectValue placeholder="Select Camera" />
                  </SelectTrigger>
                  <SelectContent>
                    {cameras.length === 0 ? (
                      <SelectItem value="default">Default Camera</SelectItem>
                    ) : (
                      cameras.map((cam, idx) => (
                        <SelectItem key={cam.deviceId} value={cam.deviceId}>
                          {cam.label || `Camera ${idx + 1}`}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Connect Button */}
              {!connected ? (
                <Button 
                  onClick={handleConnect}
                  disabled={loading}
                  className="gap-2"
                  variant="outline"
                >
                  <Wifi className="w-4 h-4" />
                  Connect to AWS
                </Button>
              ) : (
                <Button 
                  onClick={disconnect}
                  variant="outline"
                  className="gap-2"
                >
                  <WifiOff className="w-4 h-4" />
                  Disconnect
                </Button>
              )}

              {/* Start/Stop Streaming */}
              {!streaming ? (
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
                disabled={!streaming}
                className="gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reset
              </Button>
            </div>

            {/* Session Info */}
            {sessionId && (
              <div className="mt-3 text-sm text-muted-foreground">
                Session: <code className="bg-muted px-2 py-0.5 rounded">{sessionId}</code>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Video Display */}
        <Card className="overflow-hidden">
          <CardContent className="p-0 relative">
            {annotatedFrame ? (
              <img 
                src={annotatedFrame} 
                alt="YOLO Detection" 
                className="w-full aspect-video object-contain bg-black"
              />
            ) : (
              <div className="w-full aspect-video bg-muted flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <Cloud className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>{streaming ? 'Waiting for AWS response...' : 'Camera not started'}</p>
                  {!connected && <p className="text-sm mt-1">Connect to AWS first</p>}
                </div>
              </div>
            )}

            {/* Performance Overlay */}
            {streaming && (
              <div className="absolute top-2 right-2 bg-black/70 text-white px-3 py-1 rounded-lg text-sm flex gap-4">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-yellow-400" />
                  {fps.toFixed(1)} FPS
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-blue-400" />
                  {processMs.toFixed(0)} ms
                </span>
                <span className="flex items-center gap-1">
                  <Cloud className="w-3 h-3 text-orange-400" />
                  AWS
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

        {/* Architecture Info */}
        <Card className="bg-muted/50">
          <CardContent className="p-4">
            <h4 className="font-medium mb-2">How it works:</h4>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>1️⃣ <strong>Browser Camera:</strong> Your device captures video frames</p>
              <p>2️⃣ <strong>WebSocket:</strong> Frames sent to AWS server in real-time</p>
              <p>3️⃣ <strong>AWS GPU:</strong> YOLO models process frames (~{processMs || '30-50'}ms)</p>
              <p>4️⃣ <strong>Response:</strong> Annotated frames streamed back to browser</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default AWSPurityTesting;
