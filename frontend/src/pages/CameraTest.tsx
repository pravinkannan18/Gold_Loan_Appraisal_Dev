import { useMemo, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import LiveCamera, { LiveCameraRef } from "@/components/LiveCamera";
import { Camera } from "lucide-react";
import { motion } from "framer-motion";
import { StepIndicator } from "@/components/ui/step-indicator";
import { AuroraLayout } from "@/components/layouts/AuroraLayout";
import { toast } from "@/hooks/use-toast";


const stageToStepKey: Record<string, number> = {
  appraiser: 1,
  customer: 2,
  rbi: 3,
  purity: 4,
  summary: 5,
};

const CameraTest = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;

  const cameraRef = useRef<LiveCameraRef>(null);

  const handleStartCamera = async () => {
    try {
      setCameraError(null);
      
      // Check if camera is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError("Camera not available on this device");
        return;
      }
      
      // Request camera permission first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Stop the test stream immediately
        stream.getTracks().forEach(track => track.stop());
        setShowCamera(true);
      } catch (permissionError) {
        setCameraError("Camera permission denied. Please enable camera access and try again.");
        console.error("Camera permission error:", permissionError);
      }
    } catch (error) {
      setCameraError("Failed to access camera. Please check your camera settings.");
      console.error("Camera error:", error);
    }
  };

  const handleCapture = (imageData: string) => {
    setCapturedImage(imageData);
    setShowCamera(false);
    setCameraError(null);
  };

  const handleBack = () => {
    if (stage === "customer") {
      navigate("/customer-image");
    } else if (stage === "customer2") {
      navigate("/camera-test?stage=customer");
    } else {
      navigate("/rbi-compliance");
    }
  };

  return (
    <AuroraLayout>
      <div className="min-h-screen py-4 px-4">
        <div className="max-w-4xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: -20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.4 }} 
            className="mb-4"
          >
            <StepIndicator currentStep={stage === "customer" ? 2 : 4} showIndividualStep={true} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 text-center"
          >
            <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-600 to-amber-600 bg-clip-text text-transparent mb-3">
              {stage === "customer" ? "Customer Image Capture" : "Individual Image Capture"}
            </h1>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
              {stage === "customer" 
                ? "Take a clear photograph of the customer for KYC verification. Ensure proper lighting and a neutral background." 
                : "Capture a high-quality image of the individual. Make sure the subject is properly positioned and well-lit."}
            </p>
          </motion.div>

          {/* Main Card with Enhanced Styling */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm border-2 shadow-xl hover:shadow-2xl transition-all duration-300">
              <CardHeader className="border-b bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20">
                <CardTitle className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-yellow-500 to-amber-600 flex items-center justify-center">
                    <Camera className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <span className="text-xl">{stage === "customer" ? "Customer Camera" : "Individual Camera"}</span>
                    <p className="text-sm font-normal text-muted-foreground mt-1">Step {stage === "customer" ? "2" : "4"} of 6</p>
                  </div>
                </CardTitle>
                <CardDescription className="mt-2">
                  Follow the instructions below to capture a high-quality image
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
              {/* Camera Section with Enhanced UI */}
              <div>
                {showCamera ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="border-2 border-yellow-400 dark:border-yellow-600 rounded-xl p-4 bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30"
                  >
                    <div className="space-y-4">
                      <LiveCamera
                        ref={cameraRef}
                        currentStepKey={currentStepKey}
                        onCapture={handleCapture}
                        onClose={() => setShowCamera(false)}
                      />
                      <div className="flex justify-end gap-3">
                        <Button
                          variant="secondary"
                          className="font-medium"
                          onClick={() => setShowCamera(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-medium"
                          onClick={() => cameraRef.current?.capturePhoto()}
                        >
                          Capture Photo
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ) : capturedImage ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-4"
                  >
                    <div className="relative border-2 border-green-500 rounded-xl p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30">
                      <div className="absolute -top-3 left-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
                        ✓ Image Successfully Captured
                      </div>
                      <img
                        src={capturedImage}
                        alt="Captured"
                        className="w-full rounded-lg shadow-xl ring-2 ring-green-500/50 hover:ring-4 transition-all"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        onClick={() => setCapturedImage(null)}
                        variant="outline"
                        className="w-full"
                      >
                        Clear
                      </Button>
                      <Button
                        onClick={() => {
                          setCapturedImage(null);
                          handleStartCamera();
                        }}
                        className="w-full bg-gradient-to-r from-yellow-500 to-amber-600"
                      >
                        <Camera className="mr-2 h-4 w-4" />
                        Retake
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <div className="border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-12 bg-neutral-50 dark:bg-neutral-900/50 text-center">
                    <Camera className="w-20 h-20 mx-auto mb-4 text-neutral-400" />
                    <p className="text-lg font-medium text-neutral-600 dark:text-neutral-400 mb-2">
                      No Camera Active
                    </p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-500 mb-4">
                      Click the button below to start the live camera feed
                    </p>
                    {cameraError && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        {cameraError}
                      </div>
                    )}
                    <Button
                      onClick={handleStartCamera}
                      className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
                    >
                      <Camera className="mr-2 h-4 w-4" />
                      Open Camera
                    </Button>
                  </div>
                )}
              </div>

            </CardContent>
          </Card>
          </motion.div>

          {/* Navigation Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-6 flex justify-between"
          >
            <Button
              variant="outline"
              className="w-32 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm"
              onClick={handleBack}
            >
              Back
            </Button>
            <Button
              className="w-32 bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-600 hover:to-amber-700 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300"
              onClick={() => {
                if (!capturedImage) {
                  toast({
                    title: "No Image Captured",
                    description: "Please capture an image before proceeding.",
                    variant: "destructive"
                  });
                  return;
                }
                if (stage === "customer") {
                  localStorage.setItem("customerFrontImage", capturedImage);
                  navigate("/rbi-compliance");
                } else {
                  navigate("/appraisal-summary");
                }
              }}
            >
              Next
            </Button>
          </motion.div>
        </div>
      </div>
    </AuroraLayout>
  );
};

export default CameraTest;
