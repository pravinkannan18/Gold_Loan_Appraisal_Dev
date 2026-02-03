import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, ArrowRight, UserCircle, Shield, AlertCircle, Loader2, CheckCircle, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { ModernDashboardLayout } from '@/components/layouts/ModernDashboardLayout';
import { cn } from '@/lib/utils';
import { StepIndicator } from '../components/journey/StepIndicator';
import { LiveCamera, LiveCameraHandle } from '../components/journey/LiveCamera';
import { showToast } from '../lib/utils';
import { useCameraDetection } from '../hooks/useCameraDetection';

export function CustomerImage() {
    const navigate = useNavigate();
    const cameraRef = useRef<LiveCameraHandle>(null);

    // State
    const [customerImage, setCustomerImage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState('');
    const [selectedCameraId, setSelectedCameraId] = useState<string>('');

    const { getCameraForPage } = useCameraDetection();

    // Auto-load saved camera
    useEffect(() => {
        const savedCamera = getCameraForPage('customer-image-capture');
        if (savedCamera) {
            setSelectedCameraId(savedCamera.deviceId);
        }
    }, [getCameraForPage]);

    // Verify session exists
    useEffect(() => {
        const sessionId = localStorage.getItem('appraisal_session_id');
        if (!sessionId) {
            showToast('No active session. Please start from appraiser details.', 'error');
            navigate('/appraiser-details');
        }
    }, [navigate]);

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
            showToast('Camera is still starting. Please wait.', 'info');
            return;
        }
        const imageData = cameraRef.current?.captureImage();
        if (imageData && imageData !== 'data:,' && imageData.length > 100) {
            setCustomerImage(imageData);
            cameraRef.current?.closeCamera();
            setIsCameraOpen(false);
            showToast('Customer photo captured successfully!', 'success');
        } else {
            showToast('Failed to capture photo. Please try again.', 'error');
        }
    };

    const handleRetake = () => {
        setCustomerImage('');
        handleOpenCamera();
    };

    const handleNext = async () => {
        if (!customerImage) {
            showToast('Please capture a customer photo', 'error');
            return;
        }

        setIsLoading(true);
        try {
            const sessionId = localStorage.getItem('appraisal_session_id');
            if (!sessionId) {
                showToast('Session not found. Please start over.', 'error');
                navigate('/dashboard');
                return;
            }

            // Save customer image to API
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/customer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    front_image: customerImage
                })
            });

            if (!response.ok) {
                throw new Error('Failed to save customer image');
            }

            showToast('Customer photo saved!', 'success');
            navigate('/rbi-compliance');
        } catch (error: any) {
            console.error('Error saving customer image:', error);
            showToast(error?.message || 'Failed to save customer photo', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ModernDashboardLayout
            title="Customer Verification"
            showSidebar
            headerContent={<StepIndicator currentStep={2} />}
        >
            <div className="max-w-4xl mx-auto space-y-6 pb-20">

                {/* Camera Section */}
                <Card className="border-2 overflow-hidden shadow-lg">
                    <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                        <div className="flex items-center gap-2 font-semibold">
                            <Camera className="w-5 h-5 text-primary" />
                            {customerImage ? 'Customer Photo' : 'Live Camera'}
                        </div>
                        <StatusBadge variant={customerImage ? "success" : isCameraOpen ? (isCameraReady ? "success" : "warning") : "default"}>
                            {customerImage ? "Captured" : isCameraOpen ? (isCameraReady ? "Ready" : "Starting...") : "Idle"}
                        </StatusBadge>
                    </div>

                    <CardContent className="p-0">
                        {/* Captured Image Display - shown when image exists */}
                        {customerImage && (
                            <div className="relative">
                                <div className="aspect-video bg-black/95 flex items-center justify-center">
                                    <img
                                        src={customerImage}
                                        alt="Customer"
                                        className="max-w-full max-h-full object-contain"
                                    />
                                </div>
                                <div className="absolute top-4 right-4">
                                    <StatusBadge variant="success" size="sm" icon={<CheckCircle className="w-3 h-3" />}>
                                        Captured
                                    </StatusBadge>
                                </div>
                            </div>
                        )}

                        {/* Live Camera - always mounted but hidden when image captured */}
                        <div className={cn(
                            "bg-black/95 min-h-[400px] relative flex flex-col",
                            customerImage && "hidden"
                        )}>
                            <LiveCamera
                                ref={cameraRef}
                                currentStepKey={2}
                                selectedDeviceId={selectedCameraId}
                                displayMode="inline"
                                className="flex-1"
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
                        </div>

                        {/* Camera Controls */}
                        <div className="p-6 bg-background border-t">
                            {cameraError && (
                                <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 mt-0.5" />
                                    {cameraError}
                                </div>
                            )}

                            <div className="flex flex-col gap-3">
                                {customerImage ? (
                                    <Button
                                        onClick={handleRetake}
                                        variant="outline"
                                        className="w-full gap-2 h-12"
                                    >
                                        <RefreshCw className="w-4 h-4" />
                                        Retake Photo
                                    </Button>
                                ) : !isCameraOpen ? (
                                    <Button
                                        onClick={handleOpenCamera}
                                        className="w-48 self-center gap-2 h-12"
                                        disabled={isLoading}
                                    >
                                        <Camera className="w-5 h-5" />
                                        Open Camera
                                    </Button>
                                ) : (
                                    <div className="flex items-center gap-4 w-full">
                                        <Button
                                            onClick={handleCapture}
                                            disabled={!isCameraReady}
                                            className="flex-1 gap-2 h-12 text-base"
                                        >
                                            {!isCameraReady ? (
                                                <>
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                    Camera Starting...
                                                </>
                                            ) : (
                                                <>
                                                    <Camera className="w-5 h-5" />
                                                    Capture Photo
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            onClick={handleCloseCamera}
                                            variant="outline"
                                            className="flex-1 gap-2 h-12"
                                        >
                                            Close Camera
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Info Banner */}
                <div className="p-4 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 rounded-xl text-sm flex gap-3">
                    <Shield className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium mb-1">KYC Verification Photo</p>
                        <p className="text-blue-600/80 dark:text-blue-400/80">
                            This photo will be securely stored with the appraisal record for compliance purposes.
                        </p>
                    </div>
                </div>

                {/* Navigation Footer */}
                <Card className="bg-muted/30">
                    <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                            <Button
                                variant="outline"
                                onClick={() => navigate('/dashboard')}
                                className="gap-2"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Back
                            </Button>

                            <Button
                                onClick={handleNext}
                                disabled={!customerImage || isLoading}
                                className="gap-2 min-w-[140px]"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        Continue
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ModernDashboardLayout>
    );
}

export default CustomerImage;
