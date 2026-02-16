// React hooks already imported above
import { Camera, Settings, Check, X, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCameraDetection, CameraContext, CameraDevice } from '@/hooks/useCameraDetection';
import { showToast } from '@/lib/utils';
import { useState, useEffect } from 'react';

interface PageCameraConfig {
    context: CameraContext;
    pageName: string;
    description: string;
    camera: CameraDevice | null;
}

export function CameraSettings() {
    const {
        cameras,
        isLoading,
        error,
        permission,
        enumerateDevices,
        getAllSavedCameras,
        setCameraForPage,
        clearAllCameras,
        testCamera,
    } = useCameraDetection();

    const [pageConfigs, setPageConfigs] = useState<PageCameraConfig[]>([]);
    const [testingCamera, setTestingCamera] = useState<string | null>(null);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedAudioDevice, setSelectedAudioDevice] = useState<string | null>(localStorage.getItem('audio_input_device'));

    // Load all saved cameras
    useEffect(() => {
        if (cameras.length > 0) {
            const savedCameras = getAllSavedCameras();

            const configs: PageCameraConfig[] = [
                {
                    context: 'appraiser-identification',
                    pageName: 'Appraiser Identification',
                    description: 'Camera for capturing appraiser photo during facial recognition',
                    camera: savedCameras['appraiser-identification'],
                },
                {
                    context: 'customer-image-capture',
                    pageName: 'Customer Image Capture',
                    description: 'Camera for capturing customer photos (front and side view)',
                    camera: savedCameras['customer-image-capture'],
                },
                {
                    context: 'purity-testing',
                    pageName: 'Purity Testing',
                    description: 'Camera for monitoring rubbing and acid testing process',
                    camera: savedCameras['purity-testing'],
                },
                {
                    context: 'rbi-compliance',
                    pageName: 'RBI Compliance',
                    description: 'Camera for jewellery item documentation',
                    camera: savedCameras['rbi-compliance'],
                },
            ];

            setPageConfigs(configs);
        }
    }, [cameras, getAllSavedCameras]);

    // Enumerate audio input devices
    useEffect(() => {
        const enumAudio = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const inputs = devices.filter(d => d.kind === 'audioinput');
                setAudioDevices(inputs);
            } catch (err) {
                console.warn('Failed to enumerate audio devices', err);
                setAudioDevices([]);
            }
        };
        enumAudio();
        navigator.mediaDevices.addEventListener('devicechange', enumAudio);
        return () => navigator.mediaDevices.removeEventListener('devicechange', enumAudio);
    }, []);

    const handleSaveAudioDevice = (deviceId: string | null) => {
        if (deviceId) {
            localStorage.setItem('audio_input_device', deviceId);
            setSelectedAudioDevice(deviceId);
            showToast('✅ Audio input device saved', 'success');
        } else {
            localStorage.removeItem('audio_input_device');
            setSelectedAudioDevice(null);
            showToast('🗑️ Audio input cleared', 'info');
        }
    };

    const handleCameraChange = (context: CameraContext, deviceId: string) => {
        const camera = cameras.find(c => c.deviceId === deviceId) || null;

        // Update local state
        setPageConfigs(prev =>
            prev.map(config =>
                config.context === context ? { ...config, camera } : config
            )
        );
    };

    const handleSaveCamera = (context: CameraContext) => {
        const config = pageConfigs.find(c => c.context === context);
        if (config) {
            setCameraForPage(context, config.camera);
            if (config.camera) {
                showToast(`✅ Camera saved for ${config.pageName}`, 'success');
            } else {
                showToast(`🗑️ Camera settings cleared for ${config.pageName}`, 'info');
            }
        }
    };

    const handleTestCamera = async (deviceId: string) => {
        setTestingCamera(deviceId);
        const result = await testCamera(deviceId);
        setTestingCamera(null);

        if (result) {
            showToast('✅ Camera test successful!', 'success');
        } else {
            showToast('❌ Camera test failed. Camera might be in use.', 'error');
        }
    };

    const handleClearAll = () => {
        if (confirm('Clear all camera configurations? You will need to reconfigure cameras on each page.')) {
            clearAllCameras();
            setPageConfigs(prev =>
                prev.map(config => ({ ...config, camera: null }))
            );
            showToast('🗑️ All camera settings cleared', 'info');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-[hsl(48,50%,99%)] via-[hsl(158,30%,97%)] to-[hsl(320,100%,98%)] p-8">
            <div className="max-w-5xl mx-auto">
                {/* Header */}
                <div className="bg-white rounded-[30px] shadow-xl border border-[hsl(158,20%,88%)] overflow-hidden mb-6">
                    <div className="bg-gradient-to-r from-[hsl(158,82%,18%)] via-[hsl(158,75%,22%)] to-[hsl(158,70%,25%)] p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                                    <Settings className="w-8 h-8 text-white" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold text-white">Camera Settings</h1>
                                    <p className="text-[hsl(158,60%,85%)]">Configure cameras for each page</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={() => enumerateDevices()}
                                    disabled={isLoading}
                                    className="bg-white/20 hover:bg-white/30 text-white border-2 border-white/40"
                                >
                                    {isLoading ? (
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
                            </div>
                        </div>
                    </div>
                </div>

                {/* Permission/Error Messages */}
                {permission.status === 'denied' && (
                    <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 mb-6">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-semibold text-red-800">Camera Permission Denied</h3>
                                <p className="text-sm text-red-700 mt-1">{permission.error}</p>
                                <p className="text-xs text-red-600 mt-2">
                                    Please enable camera access in your browser settings and refresh the page.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-4 mb-6">
                        <p className="text-sm text-yellow-800">{error}</p>
                    </div>
                )}

                {/* Available Cameras Summary */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <Camera className="w-5 h-5 text-[hsl(158,82%,18%)]" />
                        Available Cameras ({cameras.length})
                    </h2>

                    {isLoading ? (
                        <div className="text-center py-8">
                            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto mb-3" />
                            <p className="text-gray-600">Detecting cameras...</p>
                        </div>
                    ) : cameras.length === 0 ? (
                        <div className="text-center py-8 bg-gray-50 rounded-lg">
                            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-700 font-medium mb-2">No cameras detected</p>
                            <p className="text-sm text-gray-600 mb-4">
                                Connect a camera and click "Detect Cameras"
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {cameras.map((camera, index) => (
                                <div
                                    key={camera.deviceId}
                                    className="flex items-center gap-3 p-3 bg-gradient-to-r from-[hsl(158,30%,95%)] to-[hsl(158,25%,92%)] border border-[hsl(158,25%,85%)] rounded-lg"
                                >
                                    <div className="flex-shrink-0 w-8 h-8 bg-[hsl(158,82%,18%)] text-white rounded-full flex items-center justify-center font-bold text-sm">
                                        {index + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-gray-900 truncate">{camera.label}</p>
                                        <p className="text-xs text-gray-600 truncate font-mono">
                                            {camera.deviceId.substring(0, 24)}...
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Page-Specific Camera Configuration */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold text-gray-900">Page Camera Assignments</h2>
                        <Button
                            onClick={handleClearAll}
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 border-red-300"
                        >
                            <X className="w-4 h-4 mr-2" />
                            Clear All
                        </Button>
                    </div>

                    <div className="space-y-4">
                        {pageConfigs.map((config) => (
                            <div
                                key={config.context}
                                className="border-2 border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors"
                            >
                                <div className="flex items-start gap-4">
                                    <div className="flex-1">
                                        <h3 className="font-bold text-gray-900 mb-1">{config.pageName}</h3>
                                        <p className="text-sm text-gray-600 mb-3">{config.description}</p>

                                        <div className="flex gap-2 items-center">
                                            <select
                                                value={config.camera?.deviceId || ''}
                                                onChange={(e) => handleCameraChange(config.context, e.target.value)}
                                                className="flex-1 px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-sm"
                                                disabled={cameras.length === 0}
                                            >
                                                <option value="">Select camera...</option>
                                                {cameras.map(camera => (
                                                    <option key={camera.deviceId} value={camera.deviceId}>
                                                        {camera.label}
                                                    </option>
                                                ))}
                                            </select>

                                            {config.camera && (
                                                <Button
                                                    onClick={() => handleTestCamera(config.camera!.deviceId)}
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={testingCamera === config.camera.deviceId}
                                                    title="Test Camera"
                                                >
                                                    {testingCamera === config.camera.deviceId ? (
                                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                                    ) : (
                                                        <Camera className="w-4 h-4" />
                                                    )}
                                                </Button>
                                            )}

                                            <Button
                                                onClick={() => handleSaveCamera(config.context)}
                                                size="sm"
                                                className="bg-[hsl(158,82%,18%)] hover:bg-[hsl(158,82%,25%)] text-white"
                                            >
                                                Set & Save
                                            </Button>
                                        </div>

                                        {config.camera && (
                                            <div className="mt-2 flex items-center gap-2 text-xs bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                                                <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
                                                <span className="text-green-800 font-medium">
                                                    Configured: {config.camera.label}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-shrink-0">
                                        {config.camera ? (
                                            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                                <Check className="w-6 h-6 text-green-600" />
                                            </div>
                                        ) : (
                                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                                                <X className="w-6 h-6 text-gray-400" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Help Text */}
                <div className="mt-6 bg-[hsl(158,30%,95%)] border border-[hsl(158,25%,85%)] rounded-xl p-4">
                    <h3 className="font-semibold text-[hsl(158,82%,18%)] mb-2 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        How it works
                    </h3>
                    <ul className="text-sm text-[hsl(158,40%,30%)] space-y-1 ml-6 list-disc">
                        <li>Configure cameras here or directly on each page</li>
                        <li>Each page remembers its own camera selection</li>
                        <li>Cameras auto-load when you visit each page</li>
                        <li>You can change cameras anytime</li>
                    </ul>
                </div>
            </div>

                {/* Audio Input Selection */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mt-6">
                    <h2 className="text-lg font-bold text-gray-900 mb-4">Audio Input Device</h2>

                    {audioDevices.length === 0 ? (
                        <div className="text-sm text-gray-600">No audio input devices detected. Connect a microphone and refresh.</div>
                    ) : (
                        <div className="flex items-center gap-3">
                            <select
                                value={selectedAudioDevice || ''}
                                onChange={(e) => setSelectedAudioDevice(e.target.value || null)}
                                className="p-2 border rounded w-full"
                            >
                                <option value="">Default device</option>
                                {audioDevices.map((d) => (
                                    <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
                                ))}
                            </select>
                            <Button onClick={() => handleSaveAudioDevice(selectedAudioDevice)}>
                                Save
                            </Button>
                        </div>
                    )}
                </div>
        </div>
    );
}

export default CameraSettings;
