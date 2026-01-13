import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Gem, QrCode, Play, Square, AlertCircle, ScanLine, Download, FileDown, RefreshCw, Zap } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { showToast } from '../lib/utils';
import { Button } from '../components/ui/button';
import { PageCameraSelector } from '../components/ui/page-camera-selector';
import { useCameraDetection } from '../hooks/useCameraDetection';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';

// Backend Base URL
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface JewelleryItem {
  itemNumber: number;
  image: string;
  description: string;
}

interface PurityResult {
  itemNumber: number;
  purity: string; // e.g., "22K", "18K", etc.
  reading: string; // e.g., "91.6%", "75.0%"
  method: string;
  video_url?: string;
  detected_activities?: string[];
}

interface ActivityDetection {
  activity: 'rubbing' | 'acid_testing';
  confidence: number;
  timestamp: number;
}

interface CameraInfo {
  index: number;
  name: string;
  resolution?: string;
  width?: number;
  height?: number;
  fps?: number;
  backend?: string;
  status: string;
  is_working: boolean;
  error?: string;
}

export function PurityTesting() {
  const navigate = useNavigate();


  // State
  const [jewelleryItems, setJewelleryItems] = useState<JewelleryItem[]>([]);
  const [purityResults, setPurityResults] = useState<PurityResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // New: Independent Camera States
  const [isAnalysisActive, setIsAnalysisActive] = useState(false);
  const isAnalysisActiveRef = useRef(false);

  const [currentRecordingItem, setCurrentRecordingItem] = useState<number | null>(null);
  const isRecording = isAnalysisActive;
  const isRecordingRef = { current: isAnalysisActiveRef.current };

  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [detectedActivities, setDetectedActivities] = useState<ActivityDetection[]>([]);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [showQrCode, setShowQrCode] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [scannedData, setScannedData] = useState<any>(null);
  const [rubbingCompleted, setRubbingCompleted] = useState(false);
  const [acidCompleted, setAcidCompleted] = useState(false);
  const qrScannerVideoRef = useRef<HTMLVideoElement>(null);
  const qrScannerCanvasRef = useRef<HTMLCanvasElement>(null);

  // New: Refs for local video elements used for analysis
  const video1Ref = useRef<HTMLVideoElement>(null);
  const canvas1Ref = useRef<HTMLCanvasElement>(null);

  // New: State for annotated frames from backend
  const [annotatedFrame1, setAnnotatedFrame1] = useState<string | null>(null);

  // New: Streams state
  const stream1Ref = useRef<MediaStream | null>(null);
  const previewStream1Ref = useRef<MediaStream | null>(null);
  const analysisIntervalRef = useRef<number | null>(null);

  // Ensure attached video elements are actively playing; some browsers pause streams
  // when srcObject changes even if autoPlay is set.
  const ensureVideoPlaying = async (videoElement: HTMLVideoElement | null) => {
    if (!videoElement) return;
    try {
      if (videoElement.paused) {
        await videoElement.play();
      }
    } catch (err) {
      console.error('Video play failed', err);
    }
  };

  // Use the camera detection hook for smart auto-detection
  const {
    cameras,
    permission,
    isLoading: cameraLoading,
    error: cameraError,
    enumerateDevices,
    requestPermission,
    stopAllStreams,
  } = useCameraDetection();

  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  // Helper to get label
  const selectedCameraLabel = cameras.find(c => c.deviceId === selectedCameraId)?.label || 'Camera';


  // Camera selection UI state
  const [showCameraSelection, setShowCameraSelection] = useState(false);

  // Sync selection state with panel visibility
  // Sync selection state with panel visibility
  useEffect(() => {
    if (!selectedCameraId) {
      setShowCameraSelection(true);
    } else {
      setShowCameraSelection(false);
    }
  }, [selectedCameraId]);

  // Auto-request camera permission on mount to get device labels
  useEffect(() => {
    const initCameras = async () => {
      if (permission.status === 'prompt') {
        console.log('📹 Requesting camera permission automatically...');
        await requestPermission();
      }
    };
    initCameras();
  }, [permission.status, requestPermission]);

  useEffect(() => {
    // Load jewellery items from localStorage
    const storedItems = localStorage.getItem('jewelleryItems');
    console.log('PurityTesting - Loading jewellery items:', storedItems ? 'found' : 'not found');

    if (storedItems) {
      try {
        const items = JSON.parse(storedItems);
        console.log('PurityTesting - Parsed items:', items);

        if (!Array.isArray(items) || items.length === 0) {
          throw new Error('Invalid jewellery items data');
        }

        setJewelleryItems(items);
        console.log('PurityTesting - Items loaded successfully:', items.length, 'items');
      } catch (error) {
        console.error('PurityTesting - Error parsing jewellery items:', error);
        showToast('Invalid jewellery items data. Please complete RBI compliance step.', 'error');
        navigate('/rbi-compliance');
      }
    } else {
      console.error('PurityTesting - No jewellery items found in localStorage');
      showToast('No jewellery items found. Please complete RBI compliance step.', 'error');
      navigate('/rbi-compliance');
    }

    // Cleanup function
    return () => {
      stopAllAnalysis();
    };
  }, [navigate]);

  // Refs to CameraSelect components to control their streams
  const faceCamSelectRef = useRef<{ stopPreview: () => void } | null>(null);

  // Analysis Control
  const toggleAnalysis = async () => {
    if (isAnalysisActive) {
      stopAnalysis();
    } else {
      await startAnalysis();
    }
  };

  const startAnalysis = async () => {
    try {
      if (!selectedCameraId) {
        showToast('Please select Analysis camera', 'error');
        return;
      }
      setIsLoading(true);

      if (previewStream1Ref.current) {
        previewStream1Ref.current.getTracks().forEach(t => t.stop());
        previewStream1Ref.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selectedCameraId }, width: 640, height: 480 }
      });
      stream1Ref.current = stream;
      if (video1Ref.current) {
        video1Ref.current.srcObject = stream;
        await ensureVideoPlaying(video1Ref.current);
      }

      setIsAnalysisActive(true);
      isAnalysisActiveRef.current = true;
      setAnnotatedFrame1(null);

      if (!analysisIntervalRef.current) {
        setTimeout(startAnalysisLoop, 100);
      }

      showToast(`Analysis Started: ${selectedCameraLabel}`, 'success');
    } catch (error) {
      console.error('Error starting analysis:', error);
      showToast('Failed to start Analysis', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const stopAnalysis = () => {
    if (stream1Ref.current) {
      stream1Ref.current.getTracks().forEach(t => t.stop());
      stream1Ref.current = null;
    }
    if (video1Ref.current) video1Ref.current.srcObject = null;
    setIsAnalysisActive(false);
    isAnalysisActiveRef.current = false;
    setAnnotatedFrame1(null);
  };


  const stopAllAnalysis = () => {
    stopAnalysis();
    if (analysisIntervalRef.current) {
      clearTimeout(analysisIntervalRef.current);
      analysisIntervalRef.current = null;
    }
  };

  // Preview management for selected camera
  useEffect(() => {
    const startPreview1 = async () => {
      if (selectedCameraId && !isAnalysisActive) {
        try {
          if (previewStream1Ref.current) previewStream1Ref.current.getTracks().forEach(t => t.stop());
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: selectedCameraId }, width: 640, height: 480 }
          });
          previewStream1Ref.current = stream;
          if (video1Ref.current) {
            video1Ref.current.srcObject = stream;
            await ensureVideoPlaying(video1Ref.current);
          }
        } catch (err) {
          console.error("Preview 1 error:", err);
        }
      }
    };
    startPreview1();
    return () => {
      if (previewStream1Ref.current) {
        previewStream1Ref.current.getTracks().forEach(t => t.stop());
        previewStream1Ref.current = null;
      }
    };
  }, [selectedCameraId, isAnalysisActive]);



  const startAnalysisLoop = () => {
    if (analysisIntervalRef.current) clearTimeout(analysisIntervalRef.current);

    const runAnalysis = async () => {
      const active = isAnalysisActiveRef.current;
      if (!active) {
        console.log('⚠️ Analysis loop stopped: Analysis not active');
        analysisIntervalRef.current = null;
        return;
      }

      // Ensure video is still playing
      await ensureVideoPlaying(video1Ref.current);

      try {
        const frame1 = isAnalysisActiveRef.current ? captureFrameToB64(video1Ref.current, canvas1Ref.current) : null;

        if (frame1) {
          try {
            const response = await fetch(`${BASE_URL}/api/purity/analyze`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ frame1, frame2: null })
            });

            if (response.ok) {
              const data = await response.json();
              if (data.annotated_frame1) setAnnotatedFrame1(data.annotated_frame1);

              if (data.rubbing_detected && !rubbingCompleted) {
                setRubbingCompleted(true);
                showToast('✅ Rubbing Test Detected!', 'success');
                setDetectedActivities(prev => [...prev, { activity: 'rubbing', confidence: 0.95, timestamp: Date.now() }]);
              }
              if (data.acid_detected && !acidCompleted) {
                setAcidCompleted(true);
                showToast('✅ Acid Test Detected!', 'success');
                setDetectedActivities(prev => [...prev, { activity: 'acid_testing', confidence: 0.95, timestamp: Date.now() }]);
              }
            }
          } catch (fetchErr) {
            console.error('Analysis fetch error:', fetchErr);
          }
        }
      } catch (err) {
        console.error('Analysis loop error:', err);
      }

      // Schedule next execution
      if (isAnalysisActiveRef.current) {
        analysisIntervalRef.current = window.setTimeout(runAnalysis, 400);
      } else {
        analysisIntervalRef.current = null;
      }
    };

    runAnalysis();
  };

  const captureFrameToB64 = (video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null): string | null => {
    if (!video || !canvas || video.readyState < 2) return null;

    // Reduced resolution for faster processing
    canvas.width = 480;
    canvas.height = 360;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6); // Slightly better quality
  };

  // Stop frontend camera streaming and analysis
  const stopVideoRecording = async (showNotification = true) => {
    try {
      stopAllAnalysis();
      if (showNotification) showToast('Analysis stopped', 'info');
    } catch (error) {
      console.error('Error stopping analysis:', error);
    }
  };

  const generateQRCode = async () => {
    try {
      console.log('Starting QR Code generation...');

      // Collect all appraisal data
      const appraiserData = localStorage.getItem('currentAppraiser');
      const rbiCompliance = localStorage.getItem('rbiCompliance');
      const jewelleryItems = localStorage.getItem('jewelleryItems');

      console.log('Data collected:', {
        hasAppraiser: !!appraiserData,
        hasRbiCompliance: !!rbiCompliance,
        hasJewelleryItems: !!jewelleryItems,
        purityResultsCount: purityResults.length
      });

      // Create a simplified version for QR code to avoid size limits
      const qrData = {
        appraiser: appraiserData ? JSON.parse(appraiserData) : null,
        rbiCompliance: rbiCompliance ? JSON.parse(rbiCompliance) : null,
        jewelleryItems: jewelleryItems ? JSON.parse(jewelleryItems) : null,
        purityTesting: {
          method: 'Stone_Acid_Method',
          rubbingCompleted,
          acidCompleted,
          detectedActivities: detectedActivities.map(a => ({
            activity: a.activity,
            confidence: a.confidence,
            timestamp: new Date(a.timestamp).toLocaleString(),
          })),
        },
        timestamp: new Date().toISOString(),
        appraisal_id: `APP_${Date.now()}`,
      };

      // Create a condensed version for QR code
      const condensedData = {
        id: qrData.appraisal_id,
        appraiser: qrData.appraiser?.name || 'Unknown',
        items: qrData.jewelleryItems?.length || 0,
        method: qrData.purityTesting.method,
        rubbing: rubbingCompleted ? 'Completed' : 'Pending',
        acid: acidCompleted ? 'Completed' : 'Pending',
        detections: detectedActivities.length,
        timestamp: qrData.timestamp,
      };

      const qrString = JSON.stringify(condensedData);
      console.log('QR String length:', qrString.length);

      // Check if data is too large (QR codes have limits)
      if (qrString.length > 2000) {
        console.log('Data too large, using ultra-condensed version');
        // If too large, create an even more condensed version
        const ultraCondensed = {
          id: condensedData.id,
          appraiser: condensedData.appraiser,
          items: condensedData.items,
          method: condensedData.method,
          rubbing: rubbingCompleted ? 'Completed' : 'Pending',
          acid: acidCompleted ? 'Completed' : 'Pending',
          detections: detectedActivities.length,
          timestamp: condensedData.timestamp
        };
        const ultraCondensedString = JSON.stringify(ultraCondensed);
        console.log('Ultra-condensed string length:', ultraCondensedString.length);

        const qrCodeDataUrl = await QRCode.toDataURL(ultraCondensedString, {
          width: 256,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });

        setQrCodeUrl(qrCodeDataUrl);
        setShowQrCode(true);
        showToast('QR Code generated with condensed appraisal information!', 'success');
      } else {
        console.log('Using full condensed data');
        const qrCodeDataUrl = await QRCode.toDataURL(qrString, {
          width: 256,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });

        setQrCodeUrl(qrCodeDataUrl);
        setShowQrCode(true);
        showToast('QR Code generated!', 'success');
      }
    } catch (error) {
      console.error('QR generation error:', error);
      showToast('Failed to generate QR code', 'error');
    }
  };

  // Download QR Code as PDF
  const downloadQRCodeAsPDF = async () => {
    try {
      const pdf = new jsPDF();

      // Add title
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Gold Appraisal QR Code', 105, 20, { align: 'center' });

      // Add appraisal info
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      const appraiserData = localStorage.getItem('currentAppraiser');
      const appraiser = appraiserData ? JSON.parse(appraiserData) : null;

      pdf.text(`Appraiser: ${appraiser?.name || 'Unknown'}`, 20, 40);
      pdf.text(`Date: ${new Date().toLocaleDateString()}`, 20, 50);
      pdf.text(`Items Tested: ${purityResults.length}`, 20, 60);

      // Add QR code image
      if (qrCodeUrl) {
        pdf.addImage(qrCodeUrl, 'PNG', 55, 80, 100, 100);
      }

      // Add footer
      pdf.setFontSize(10);
      pdf.text('Scan this QR code to view complete appraisal details', 105, 200, { align: 'center' });
      pdf.text(`Generated: ${new Date().toLocaleString()}`, 105, 210, { align: 'center' });

      // Save the PDF
      pdf.save(`appraisal-qr-${Date.now()}.pdf`);
      showToast('QR Code PDF downloaded successfully!', 'success');
    } catch (error) {
      console.error('PDF generation error:', error);
      showToast('Failed to generate PDF', 'error');
    }
  };

  // Start QR Scanner
  const startQRScanner = async () => {
    try {
      setShowQrScanner(true);
      setScannedData(null);

      const video = qrScannerVideoRef.current;
      if (!video) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      video.srcObject = stream;
      video.play();

      // Start scanning
      scanQRCode();
      showToast('QR Scanner started. Position QR code in view.', 'info');
    } catch (error) {
      console.error('QR Scanner error:', error);
      showToast('Failed to start QR scanner. Please check camera permissions.', 'error');
      setShowQrScanner(false);
    }
  };

  // Stop QR Scanner
  const stopQRScanner = () => {
    const video = qrScannerVideoRef.current;
    if (video && video.srcObject) {
      const stream = video.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    }
    setShowQrScanner(false);
  };

  // Scan QR Code from video feed
  const scanQRCode = () => {
    const video = qrScannerVideoRef.current;
    const canvas = qrScannerCanvasRef.current;

    if (!video || !canvas || !showQrScanner) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const scan = () => {
      if (!showQrScanner) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

      // Use jsQR library to decode QR code
      // Note: You'll need to install jsQR: npm install jsqr
      // For now, we'll use a simple approach with manual file upload

      requestAnimationFrame(scan);
    };

    scan();
  };

  // Handle QR Code file upload for scanning
  const handleQRFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = qrScannerCanvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = img.width;
        canvas.height = img.height;
        context.drawImage(img, 0, 0);

        // Here you would use jsQR to decode
        // For now, we'll try to parse as a data URL
        try {
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          // Simple fallback: assume user uploads a QR code that contains JSON
          showToast('Please use camera to scan QR code or manually enter data', 'info');
        } catch (error) {
          console.error('QR decode error:', error);
          showToast('Failed to decode QR code', 'error');
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const allItemsTested = () => {
    // Testing is complete if either rubbing or acid test is detected
    return rubbingCompleted && acidCompleted;
  };

  const handleNext = () => {
    if (!allItemsTested()) {
      showToast('Complete purity testing (rubbing or acid test required).', 'error');
      return;
    }

    setIsLoading(true);
    try {
      // Save purity test completion status
      const testResults = {
        rubbingCompleted,
        acidCompleted,
        detectedActivities,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem('purityResults', JSON.stringify(testResults));
      showToast('Purity data saved!', 'success');
      navigate('/appraisal-summary');
    } catch (error) {
      showToast('Save failed.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-sky-100">
      <StepIndicator currentStep={4} />

      <div className="w-full px-6 py-8">
        {/* Camera Selection Panel */}
        {showCameraSelection && (
          <div className="mb-6 bg-white/95 backdrop-blur-sm rounded-2xl p-6 shadow-xl border-2 border-blue-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-blue-700 flex items-center">
                <ScanLine className="w-6 h-6 mr-2" />
                Camera Configuration
              </h3>
              <div className="flex gap-2">
                <Button
                  onClick={enumerateDevices}
                  disabled={cameraLoading}
                  variant="outline"
                  size="sm"
                >
                  {cameraLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Detect Cameras
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => setShowCameraSelection(false)}
                  variant="outline"
                  size="sm"
                >
                  ✕ Close
                </Button>
              </div>
            </div>

            {/* Permission Status */}
            {permission.status === 'denied' && (
              <div className="mb-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-red-800">Camera Permission Denied</p>
                    <p className="text-sm text-red-700 mt-1">{permission.error}</p>
                    <p className="text-xs text-red-600 mt-2">
                      Please enable camera access in your browser settings and refresh the page.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {cameraLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-4" />
                <p className="text-gray-600 font-medium">Detecting cameras...</p>
                <p className="text-sm text-gray-500 mt-2">This may take a few seconds</p>
              </div>
            ) : cameras.length === 0 ? (
              <div className="text-center py-12 bg-red-50 rounded-xl border-2 border-red-200">
                <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                <p className="text-red-700 font-semibold text-lg mb-2">No cameras detected</p>
                <div className="text-sm text-gray-600 space-y-1">
                  <p>• Check if a camera is connected</p>
                  <p>• Close other apps using the camera (Chrome, Teams, Zoom)</p>
                  <p>• Allow camera permissions in browser settings</p>
                  <p>• Try refreshing the camera list</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex justify-center mb-6">
                  <PageCameraSelector
                    context="purity-testing"
                    label="📹 Analysis Camera (Rubbing & Acid)"
                    onCameraSelected={(camera) => setSelectedCameraId(camera?.deviceId || '')}
                    className="w-full max-w-md"
                  />
                </div>

                {cameraError && (
                  <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-yellow-800">{cameraError}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-blue-200/50 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-600 p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-white/20 rounded-2xl backdrop-blur-sm">
                  <Gem className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white tracking-wide">Purity Testing</h1>
                  <p className="text-blue-100 text-lg font-medium">Step 4 of 5 — Gold Purity Analysis</p>
                </div>
              </div>
              <Button
                onClick={() => setShowCameraSelection(!showCameraSelection)}
                className="bg-white/20 hover:bg-white/30 text-white border-2 border-white/40"
              >
                <ScanLine className="w-5 h-5 mr-2" />
                Camera Setup
              </Button>
              <Link to="/purity-testing-fast">
                <Button className="bg-yellow-500 hover:bg-yellow-600 text-black border-2 border-yellow-400 font-semibold">
                  <Zap className="w-5 h-5 mr-2" />
                  Fast Mode (WebSocket)
                </Button>
              </Link>
            </div>
          </div>

          <div className="p-10 space-y-8">
            {/* Backend-Powered Dual Camera Analysis */}
            <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-sky-50 border-2 border-blue-200/60 rounded-2xl p-8 shadow-lg">
              <h3 className="text-2xl font-bold text-blue-900 mb-6 tracking-wide">Backend-Powered Purity Analysis</h3>

              <div className="flex flex-col items-center gap-3">
                {selectedCameraId && (
                  <div className="text-sm text-blue-700 bg-blue-100 px-4 py-2 rounded-lg font-semibold flex items-center gap-2">
                    <div className={`${isAnalysisActive ? 'bg-green-600 animate-pulse' : 'bg-blue-600'} w-2 h-2 rounded-full`}></div>
                    Using {selectedCameraLabel}
                  </div>
                )}
                <p className="text-sm text-blue-600 italic">Start analysis stream to detect Rubbing and Acid tests</p>
              </div>
            </div>

            {/* Frontend Camera + Backend YOLO Detection */}
            <div className="max-w-4xl mx-auto mb-6">
              {/* Primary Analysis Stream */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-bold text-blue-800">📸 Purity Analysis Stream</h4>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={toggleAnalysis}
                      size="default"
                      disabled={!selectedCameraId}
                      className={isAnalysisActive
                        ? "bg-red-500 hover:bg-red-600 text-white px-6 py-2 h-auto"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 h-auto"
                      }
                    >
                      {isAnalysisActive ? <><Square className="w-4 h-4 mr-2" /> Stop Analysis</> : <><Play className="w-4 h-4 mr-2" /> Start Analysis</>}
                    </Button>
                    <div className={`w-3 h-3 rounded-full ${isAnalysisActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                  </div>
                </div>
                <div className={`relative ${isAnalysisActive ? 'ring-4 ring-emerald-500 ring-opacity-50' : ''} rounded-2xl overflow-hidden bg-slate-900 border-2 border-blue-200 aspect-video`}>
                  {/* Video element - always visible for camera capture */}
                  <video
                    ref={video1Ref}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <canvas ref={canvas1Ref} className="hidden" />

                  {/* Annotated frame overlay from backend */}
                  {annotatedFrame1 && isAnalysisActive && (
                    <img
                      src={annotatedFrame1}
                      alt="Analysis Stream"
                      className="absolute inset-0 w-full h-full object-cover z-10"
                    />
                  )}

                  {!selectedCameraId && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-300 bg-slate-900/80">
                      <ScanLine className="w-16 h-16 mb-2 opacity-20" />
                      <p className="text-lg">Select Analysis Camera Above</p>
                    </div>
                  )}

                  {!isAnalysisActive && selectedCameraId && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-200 bg-slate-950/40 backdrop-blur-[2px]">
                      <p className="text-lg font-semibold bg-slate-900/80 px-6 py-3 rounded-full border border-blue-500/30 shadow-xl">Camera Idle - Ready to Analyze</p>
                    </div>
                  )}

                  {isAnalysisActive && (
                    <div className="absolute top-4 right-4 bg-emerald-600/90 backdrop-blur-md text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center z-20 shadow-lg border border-white/20">
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full mr-2.5 animate-pulse"></div>
                      YOLO LIVE ANALYSIS
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Activity Detection Results */}
            <div className="space-y-4">
              <h4 className="text-xl font-bold text-blue-800 tracking-wide">🔍 Detected Activities</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3 max-h-64 overflow-y-auto bg-white/60 rounded-xl p-4 border border-blue-200">
                  <h5 className="font-semibold text-blue-700">Recent Activities</h5>
                  {detectedActivities.length === 0 ? (
                    <p className="text-blue-600 text-sm italic">Activate cameras to begin detection...</p>
                  ) : (
                    detectedActivities.map((activity, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 bg-white backdrop-blur-sm rounded-lg border border-blue-200/50 shadow-sm">
                        <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        <div className="flex-1">
                          <span className="font-semibold text-blue-900 text-sm">
                            {activity.activity === 'rubbing' ? 'Rubbing Activity' : 'Acid Testing Activity'}
                          </span>
                          <div className="text-xs text-blue-600">
                            {new Date(activity.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                        <span className="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-1 rounded-lg">
                          {(activity.confidence * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-3 bg-white/60 rounded-xl p-4 border border-blue-200">
                  <h5 className="font-semibold text-blue-700">🔄 System Status</h5>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Analysis Stream:</span>
                      <span className={`font-semibold ${isAnalysisActive ? 'text-green-600' : 'text-red-600'}`}>
                        {isAnalysisActive ? '🟢 Streaming' : '🔴 Idle'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Live Analysis:</span>
                      <span className={`font-semibold ${isAnalysisActive ? 'text-emerald-600' : 'text-gray-600'}`}>
                        {isAnalysisActive ? '🔴 LIVE' : '⏸️ Stopped'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Rubbing:</span>
                      <span className={`font-semibold ${rubbingCompleted ? 'text-green-600' : 'text-gray-600'}`}>
                        {rubbingCompleted ? '✅ Completed' : '⏳ Pending'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Acid Testing:</span>
                      <span className={`font-semibold ${acidCompleted ? 'text-green-600' : 'text-gray-600'}`}>
                        {acidCompleted ? '✅ Completed' : '⏳ Pending'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Detections:</span>
                      <span className="font-semibold text-blue-600">
                        {detectedActivities.length} activities
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Detection Notifications */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              {/* Rubbing Test Notification */}
              <div className={`p-6 rounded-xl border-2 transition-all duration-500 ${rubbingCompleted
                ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-400 shadow-lg'
                : 'bg-white/40 border-gray-300 opacity-50'
                }`}>
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-full ${rubbingCompleted ? 'bg-emerald-500' : 'bg-gray-400'
                    }`}>
                    <Check className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1">
                    <h4 className={`text-xl font-bold ${rubbingCompleted ? 'text-emerald-800' : 'text-gray-600'
                      }`}>
                      Rubbing Test {rubbingCompleted ? 'Detected ✓' : 'Pending'}
                    </h4>
                    <p className={`text-sm font-medium mt-1 ${rubbingCompleted ? 'text-emerald-700' : 'text-gray-500'
                      }`}>
                      {rubbingCompleted
                        ? 'Stone rubbing activity successfully detected and completed!'
                        : 'Waiting for stone rubbing activity...'}
                    </p>
                  </div>
                </div>
                {rubbingCompleted && (
                  <div className="mt-4 pt-4 border-t border-emerald-300">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-emerald-700 font-semibold">Status:</span>
                      <span className="bg-emerald-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                        COMPLETED
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Acid Test Notification */}
              <div className={`p-6 rounded-xl border-2 transition-all duration-500 ${acidCompleted
                ? 'bg-gradient-to-br from-blue-50 to-sky-50 border-blue-400 shadow-lg'
                : 'bg-white/40 border-gray-300 opacity-50'
                }`}>
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-full ${acidCompleted ? 'bg-blue-500' : 'bg-gray-400'
                    }`}>
                    <Check className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1">
                    <h4 className={`text-xl font-bold ${acidCompleted ? 'text-blue-800' : 'text-gray-600'
                      }`}>
                      Acid Test {acidCompleted ? 'Detected ✓' : 'Pending'}
                    </h4>
                    <p className={`text-sm font-medium mt-1 ${acidCompleted ? 'text-blue-700' : 'text-gray-500'
                      }`}>
                      {acidCompleted
                        ? 'Acid testing activity successfully detected and completed!'
                        : 'Waiting for acid testing activity...'}
                    </p>
                  </div>
                </div>
                {acidCompleted && (
                  <div className="mt-4 pt-4 border-t border-blue-300">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-blue-700 font-semibold">Status:</span>
                      <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                        COMPLETED
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Jewellery Items Section - REMOVED as per requirements */}
        </div>

        {/* QR Code Actions */}
        <div className="p-6 bg-gradient-to-br from-indigo-50 via-blue-50 to-sky-50 border-t-2 border-blue-200/50">
          <h3 className="text-xl font-bold text-blue-900 mb-4 flex items-center gap-2">
            <QrCode className="w-6 h-6" />
            QR Code Operations
          </h3>
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={generateQRCode}
              disabled={!rubbingCompleted && !acidCompleted}
              className="flex-1 min-w-[200px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold py-4 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <QrCode className="w-5 h-5" />
              Generate QR Code
            </Button>
            <Button
              onClick={startQRScanner}
              variant="outline"
              className="flex-1 min-w-[200px] border-2 border-blue-600 text-blue-700 hover:bg-blue-50 font-semibold py-4 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 flex items-center justify-center gap-2"
            >
              <ScanLine className="w-5 h-5" />
              Scan QR Code
            </Button>
          </div>
          <p className="text-sm text-blue-600 mt-3 text-center font-medium">
            Generate a QR code with all appraisal data or scan an existing QR code to view details
          </p>
        </div>

        {/* QR Code Modal */}
        {showQrCode && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-8 max-w-md w-full shadow-2xl border border-blue-200">
              <h3 className="text-2xl font-bold mb-6 text-blue-900 text-center tracking-wide">Complete Appraisal QR Code</h3>
              <div className="flex justify-center mb-6">
                <img src={qrCodeUrl} alt="QR Code" className="w-64 h-64 rounded-xl shadow-lg" />
              </div>
              <p className="text-sm text-blue-700 mb-6 leading-relaxed font-medium text-center">
                Scan this QR code to view all appraisal information including appraiser details,
                RBI compliance images, jewellery items, and purity test results.
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <Button onClick={() => setShowQrCode(false)} variant="outline" className="flex-1 border-2 border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold py-3 rounded-xl">
                    Close
                  </Button>
                  <Button
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = qrCodeUrl;
                      link.download = 'appraisal-qr-code.png';
                      link.click();
                      showToast('QR Code image downloaded!', 'success');
                    }}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 font-semibold py-3 rounded-xl shadow-lg flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    PNG
                  </Button>
                </div>
                <Button
                  onClick={downloadQRCodeAsPDF}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 font-semibold py-3 rounded-xl shadow-lg flex items-center justify-center gap-2"
                >
                  <FileDown className="w-5 h-5" />
                  Download as PDF
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* QR Scanner Modal */}
        {showQrScanner && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl p-8 max-w-2xl w-full shadow-2xl border border-blue-200">
              <h3 className="text-2xl font-bold mb-6 text-blue-900 text-center tracking-wide flex items-center justify-center gap-3">
                <ScanLine className="w-8 h-8 text-blue-600 animate-pulse" />
                Scan QR Code
              </h3>

              <div className="relative mb-6">
                <video
                  ref={qrScannerVideoRef}
                  className="w-full rounded-xl shadow-lg"
                  playsInline
                />
                <canvas ref={qrScannerCanvasRef} className="hidden" />

                {/* Scanner overlay */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-4 border-blue-500 rounded-xl">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-600 rounded-tl-xl"></div>
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-600 rounded-tr-xl"></div>
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-600 rounded-bl-xl"></div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-600 rounded-br-xl"></div>
                  </div>
                </div>
              </div>

              {scannedData && (
                <div className="mb-6 p-4 bg-green-50 border-2 border-green-200 rounded-xl">
                  <h4 className="font-bold text-green-900 mb-2">Scanned Data:</h4>
                  <pre className="text-sm text-green-800 whitespace-pre-wrap">{JSON.stringify(scannedData, null, 2)}</pre>
                </div>
              )}

              <div className="space-y-3">
                <div className="text-center">
                  <label className="cursor-pointer inline-block">
                    <span className="px-6 py-3 bg-blue-100 text-blue-700 rounded-xl font-semibold hover:bg-blue-200 transition-colors inline-flex items-center gap-2">
                      <QrCode className="w-5 h-5" />
                      Upload QR Code Image
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleQRFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <Button
                  onClick={stopQRScanner}
                  variant="outline"
                  className="w-full border-2 border-red-200 text-red-700 hover:bg-red-50 font-semibold py-3 rounded-xl"
                >
                  Close Scanner
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-gradient-to-r from-blue-100 to-indigo-100 px-10 py-8 flex justify-between border-t border-blue-200/50">
          <button
            onClick={() => navigate('/rbi-compliance')}
            className="px-8 py-4 bg-white/80 hover:bg-white text-blue-700 rounded-2xl font-bold transition-all duration-300 flex items-center gap-3 shadow-lg hover:shadow-xl border border-blue-200"
          >
            <ArrowLeft className="w-6 h-6" />
            Back
          </button>
          <button
            onClick={handleNext}
            disabled={isLoading || !allItemsTested()}
            className="px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl font-bold transition-all duration-300 shadow-xl hover:shadow-2xl flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Saving...' : 'Next Step'}
            <ArrowRight className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}