import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Gem, QrCode, Play, Square, AlertCircle, ScanLine, Download, FileDown, RefreshCw } from 'lucide-react';
import { StepIndicator } from '../components/journey/StepIndicator';
import { showToast } from '../lib/utils';
import { Button } from '../components/ui/button';
import { CameraSelect } from '../components/ui/camera-select';
import { useCameraDetection } from '../hooks/useCameraDetection';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';

// Backend Base URL
const BASE_URL = 'http://localhost:8000'; // Change if backend runs elsewhere

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
  const [isRecording, setIsRecording] = useState(false);
  const [currentRecordingItem, setCurrentRecordingItem] = useState<number | null>(null);
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
  const video2Ref = useRef<HTMLVideoElement>(null);
  const canvas1Ref = useRef<HTMLCanvasElement>(null);
  const canvas2Ref = useRef<HTMLCanvasElement>(null);

  // New: State for annotated frames from backend
  const [annotatedFrame1, setAnnotatedFrame1] = useState<string | null>(null);
  const [annotatedFrame2, setAnnotatedFrame2] = useState<string | null>(null);

  // New: Streams state
  const stream1Ref = useRef<MediaStream | null>(null);
  const stream2Ref = useRef<MediaStream | null>(null);
  const previewStream1Ref = useRef<MediaStream | null>(null);
  const previewStream2Ref = useRef<MediaStream | null>(null);
  const analysisIntervalRef = useRef<number | null>(null);

  // Use the camera detection hook for smart auto-detection
  const {
    cameras,
    selectedFaceCam,
    selectedScanCam,
    permission,
    isLoading: cameraLoading,
    error: cameraError,
    selectFaceCam,
    selectScanCam,
    resetToAutoSelection,
    testCamera,
    enumerateDevices,
    requestPermission,
    stopAllStreams,
  } = useCameraDetection();

  // Camera selection UI state
  const [showCameraSelection, setShowCameraSelection] = useState(!selectedFaceCam || !selectedScanCam);

  // Sync selection state with panel visibility
  useEffect(() => {
    if (!selectedFaceCam || !selectedScanCam) {
      setShowCameraSelection(true);
    }
  }, [selectedFaceCam, selectedScanCam]);

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

    // Cleanup function to stop recording and polling when component unmounts
    return () => {
      stopVideoRecording();
    };
  }, [navigate]);

  // Refs to CameraSelect components to control their streams
  const faceCamSelectRef = useRef<{ stopPreview: () => void } | null>(null);
  const scanCamSelectRef = useRef<{ stopPreview: () => void } | null>(null);

  // Start local camera streaming and frontend-driven analysis
  const startVideoRecording = async (itemNumber: number) => {
    try {
      // Check if cameras are selected
      if (!selectedFaceCam || !selectedScanCam) {
        showToast('Please select cameras first', 'error');
        setShowCameraSelection(true);
        return;
      }

      // Check camera permission
      if (permission.status === 'denied') {
        showToast(permission.error || 'Camera permission denied', 'error');
        return;
      }

      setIsLoading(true);

      // CRITICAL: Stop preview streams before starting analysis streams
      // to avoid 'Camera Busy' or 'NotReadableError'
      if (previewStream1Ref.current) {
        previewStream1Ref.current.getTracks().forEach(t => t.stop());
        previewStream1Ref.current = null;
      }
      if (previewStream2Ref.current) {
        previewStream2Ref.current.getTracks().forEach(t => t.stop());
        previewStream2Ref.current = null;
      }

      console.log('📹 Opening cameras locally...');

      // Open Camera 1 (Top View)
      const stream1 = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: selectedFaceCam.deviceId }, width: 640, height: 480 }
      });
      stream1Ref.current = stream1;
      if (video1Ref.current) video1Ref.current.srcObject = stream1;

      // Open Camera 2 (Side View)
      if (selectedFaceCam.deviceId !== selectedScanCam.deviceId) {
        const stream2 = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: selectedScanCam.deviceId }, width: 640, height: 480 }
        });
        stream2Ref.current = stream2;
        if (video2Ref.current) video2Ref.current.srcObject = stream2;
      } else {
        stream2Ref.current = stream1;
        if (video2Ref.current) video2Ref.current.srcObject = stream1;
      }

      setIsRecording(true);
      setCurrentRecordingItem(itemNumber);
      setDetectedActivities([]);
      setRubbingCompleted(false);
      setAcidCompleted(false);
      setAnnotatedFrame1(null);
      setAnnotatedFrame2(null);

      // Reset backend detection status
      await fetch(`${BASE_URL}/api/purity/reset_status`, { method: 'POST' });

      // Start analysis loop
      startAnalysisLoop();

      showToast(`Local analysis started using ${selectedFaceCam.label} and ${selectedScanCam.label}`, 'success');
    } catch (error) {
      console.error('Error starting video recording:', error);
      setIsRecording(false);
      showToast(error instanceof Error ? error.message : 'Failed to start video recording', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Preview management for selected cameras
  useEffect(() => {
    const startPreview1 = async () => {
      if (selectedFaceCam && !isRecording) {
        try {
          if (previewStream1Ref.current) previewStream1Ref.current.getTracks().forEach(t => t.stop());
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: selectedFaceCam.deviceId }, width: 640, height: 480 }
          });
          previewStream1Ref.current = stream;
          if (video1Ref.current) video1Ref.current.srcObject = stream;
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
  }, [selectedFaceCam, isRecording]);

  useEffect(() => {
    const startPreview2 = async () => {
      if (selectedScanCam && !isRecording) {
        try {
          if (previewStream2Ref.current) {
            previewStream2Ref.current.getTracks().forEach(t => t.stop());
          }

          if (selectedFaceCam?.deviceId === selectedScanCam.deviceId) {
            if (video2Ref.current) video2Ref.current.srcObject = previewStream1Ref.current;
            previewStream2Ref.current = previewStream1Ref.current;
          } else {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: selectedScanCam.deviceId }, width: 640, height: 480 }
            });
            previewStream2Ref.current = stream;
            if (video2Ref.current) video2Ref.current.srcObject = stream;
          }
        } catch (err) {
          console.error("Preview 2 error:", err);
        }
      }
    };
    startPreview2();
    return () => {
      if (previewStream2Ref.current && previewStream2Ref.current !== previewStream1Ref.current) {
        previewStream2Ref.current.getTracks().forEach(t => t.stop());
        previewStream2Ref.current = null;
      }
    };
  }, [selectedScanCam, isRecording, selectedFaceCam]);

  const startAnalysisLoop = () => {
    if (analysisIntervalRef.current) clearInterval(analysisIntervalRef.current);

    analysisIntervalRef.current = window.setInterval(async () => {
      if (!isRecording && !stream1Ref.current) return;

      try {
        const frame1 = captureFrameToB64(video1Ref.current, canvas1Ref.current);
        const frame2 = captureFrameToB64(video2Ref.current, canvas2Ref.current);

        if (!frame1 && !frame2) return;

        const response = await fetch(`${BASE_URL}/api/purity/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame1, frame2 })
        });

        if (response.ok) {
          const data = await response.json();
          // Update annotated frames only if data is present, otherwise reset to null to show local video
          setAnnotatedFrame1(data.annotated_frame1 || null);
          setAnnotatedFrame2(data.annotated_frame2 || null);

          // Update flags
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
      } catch (err) {
        console.error('Analysis loop error:', err);
      }
    }, 200); // 5 FPS for analysis to balance load
  };

  const captureFrameToB64 = (video: HTMLVideoElement | null, canvas: HTMLCanvasElement | null): string | null => {
    if (!video || !canvas || video.readyState < 2) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6); // Lower quality for faster transport
  };

  // Stop local streaming and analysis
  const stopVideoRecording = async (showNotification = true) => {
    try {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
        analysisIntervalRef.current = null;
      }

      if (stream1Ref.current) {
        stream1Ref.current.getTracks().forEach(track => track.stop());
        stream1Ref.current = null;
      }
      if (stream2Ref.current && stream2Ref.current !== stream1Ref.current) {
        stream2Ref.current.getTracks().forEach(track => track.stop());
        stream2Ref.current = null;
      }

      setIsRecording(false);
      setCurrentRecordingItem(null);

      if (showNotification) showToast('Streaming and analysis stopped', 'info');
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

      <div className="max-w-6xl mx-auto px-4 py-8">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  {/* Face Camera Selection with Smart Detection */}
                  <CameraSelect
                    label="📹 Top View Camera (Rubbing Test)"
                    devices={cameras}
                    selectedDevice={selectedFaceCam}
                    onSelect={selectFaceCam}
                    onTest={testCamera}
                  />

                  {/* Scan Camera Selection with Smart Detection */}
                  <CameraSelect
                    label="📹 Side View Camera (Acid Test)"
                    devices={cameras}
                    selectedDevice={selectedScanCam}
                    onSelect={selectScanCam}
                    onTest={testCamera}
                  />
                </div>

                {/* Camera Info Display */}
                <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-blue-800 font-bold">
                      📊 Available Cameras ({cameras.length}):
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {cameras.map((camera) => {
                      const isSelected =
                        camera.deviceId === selectedFaceCam?.deviceId ||
                        camera.deviceId === selectedScanCam?.deviceId;

                      return (
                        <div
                          key={camera.deviceId}
                          className={`text-xs p-3 rounded-lg border-2 transition-all ${isSelected
                            ? 'bg-blue-100 text-blue-900 border-blue-400 font-semibold'
                            : 'bg-white text-gray-700 border-gray-200'
                            }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {isSelected && <div className="w-2 h-2 bg-blue-600 rounded-full"></div>}
                            <span className="font-mono font-bold">
                              {camera.label || `Camera ${camera.index}`}
                            </span>
                          </div>
                          <div className="text-xs opacity-75 font-mono">
                            ID: {camera.deviceId ? camera.deviceId.substring(0, 20) + '...' : 'N/A'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
            </div>
          </div>

          <div className="p-10 space-y-8">
            {/* Backend-Powered Dual Camera Analysis */}
            <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-sky-50 border-2 border-blue-200/60 rounded-2xl p-8 shadow-lg">
              <h3 className="text-2xl font-bold text-blue-900 mb-6 tracking-wide">Backend-Powered Dual Camera Analysis</h3>

              {/* Start/Stop Controls */}
              <div className="mb-6 flex flex-col items-center gap-3">
                {selectedFaceCam && selectedScanCam && (
                  <div className="text-sm text-blue-700 bg-blue-100 px-4 py-2 rounded-lg font-semibold flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
                    Using {selectedFaceCam.label} (Top) & {selectedScanCam.label} (Side)
                  </div>
                )}
                {!isRecording ? (
                  <Button
                    onClick={() => startVideoRecording(1)}
                    disabled={!selectedFaceCam || !selectedScanCam || permission.status === 'denied'}
                    className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-semibold px-8 py-4 rounded-xl shadow-lg transition-all duration-300 hover:shadow-xl text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-6 h-6 mr-3" />
                    {!selectedFaceCam || !selectedScanCam
                      ? 'Select Cameras First'
                      : permission.status === 'denied'
                        ? 'Camera Permission Denied'
                        : 'Start Backend Analysis'}
                  </Button>
                ) : (
                  <Button
                    onClick={() => stopVideoRecording()}
                    className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-white font-semibold px-8 py-4 rounded-xl shadow-lg transition-all duration-300 hover:shadow-xl text-lg"
                  >
                    <Square className="w-6 h-6 mr-3" />
                    Stop Analysis
                  </Button>
                )}
              </div>

              {/* Frontend-Driven Dual Camera Analysis */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Primary Analysis Camera */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-lg font-bold text-blue-800">📹 Top View Analysis (Rubbing Test)</h4>
                    <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                  </div>
                  <div className={`relative ${isRecording ? 'ring-4 ring-emerald-500 ring-opacity-50' : ''} rounded-xl overflow-hidden bg-slate-900 border-2 border-blue-200`}>
                    {/* Video for capture/preview */}
                    <video
                      ref={video1Ref}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-64 object-cover ${annotatedFrame1 ? 'hidden' : 'block'}`}
                    />
                    <canvas ref={canvas1Ref} className="hidden" />

                    {/* Display annotated frame */}
                    {annotatedFrame1 && (
                      <img
                        src={annotatedFrame1}
                        alt="Top View Annotated"
                        className="w-full h-64 object-cover"
                      />
                    )}

                    {!selectedFaceCam && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-300 bg-slate-900/80">
                        <ScanLine className="w-12 h-12 mb-2 opacity-20" />
                        <p className="text-sm">Select Top View Camera</p>
                      </div>
                    )}

                    {isRecording && (
                      <div className="absolute top-2 right-2 bg-emerald-600/80 backdrop-blur-sm text-white px-3 py-1 rounded-lg text-xs font-bold flex items-center">
                        <div className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse"></div>
                        LIVE ANALYSIS
                      </div>
                    )}
                  </div>
                </div>

                {/* Secondary Monitor Camera */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-lg font-bold text-blue-800">📹 Side View Analysis (Acid Test)</h4>
                    <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`}></div>
                  </div>
                  <div className={`relative rounded-xl overflow-hidden bg-slate-900 border-2 border-blue-200 ${!isRecording ? 'opacity-75' : ''}`}>
                    {/* Video for capture/preview */}
                    <video
                      ref={video2Ref}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-64 object-cover ${annotatedFrame2 ? 'hidden' : 'block'}`}
                    />
                    <canvas ref={canvas2Ref} className="hidden" />

                    {/* Display annotated frame */}
                    {annotatedFrame2 && (
                      <img
                        src={annotatedFrame2}
                        alt="Side View Annotated"
                        className="w-full h-64 object-cover"
                      />
                    )}

                    {!selectedScanCam && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-blue-300 bg-slate-900/80">
                        <ScanLine className="w-12 h-12 mb-2 opacity-20" />
                        <p className="text-sm">Select Side View Camera</p>
                      </div>
                    )}

                    <div className="absolute top-2 right-2 bg-blue-600/80 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-[10px] font-bold">
                      SIDE MONITOR
                    </div>
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
                      <p className="text-blue-600 text-sm italic">Start recording to detect activities...</p>
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
                        <span>Analysis Camera:</span>
                        <span className={`font-semibold ${isRecording ? 'text-green-600' : 'text-red-600'}`}>
                          {isRecording ? '🟢 Streaming' : '🔴 Idle'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>Monitor Camera:</span>
                        <span className={`font-semibold ${isRecording ? 'text-green-600' : 'text-red-600'}`}>
                          {isRecording ? '🟢 Streaming' : '🔴 Idle'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>Live Analysis:</span>
                        <span className={`font-semibold ${isRecording ? 'text-emerald-600' : 'text-gray-600'}`}>
                          {isRecording ? '🔴 LIVE' : '⏸️ Stopped'}
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
    </div>
  );
}