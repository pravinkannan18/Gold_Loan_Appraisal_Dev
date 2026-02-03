import { useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard, FeatureCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ModernDashboardLayout } from "@/components/layouts/ModernDashboardLayout";
import { StatusBadge, LiveBadge } from "@/components/ui/status-badge";
import { useTenant } from "@/contexts/TenantContext";
import Navigation from "@/components/Navigation";
import {
  LogOut, Camera, FileText, X, CheckCircle, User, Settings,
  Play, Sparkles, Shield, FlaskConical, ChevronRight, Clock,
  TrendingUp, Activity, Building2, MapPin, Users
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import LiveCamera, { LiveCameraRef } from "@/components/LiveCamera";
import FacialRecognition from "@/components/FacialRecognition";

const stageToStepKey: Record<string, number> = {
  appraiser: 1,
  customer: 2,
  rbi: 3,
  purity: 4,
  summary: 5,
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { state, getCurrentTenantInfo } = useTenant();
  const { currentBank, currentBranch, currentUser, permissions } = state;
  const tenantInfo = getCurrentTenantInfo();
  
  const [showCameraTest, setShowCameraTest] = useState(false);
  const [showFacialRecognition, setShowFacialRecognition] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraTesting, setIsCameraTesting] = useState(false);
  const [cameraTestComplete, setCameraTestComplete] = useState(false);
  const cameraRef = useRef<LiveCameraRef>(null);
  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;

  const handleCameraQualityCheck = async () => {
    try {
      setCameraError(null);
      setIsCameraTesting(true);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera not supported on this browser/device");
      }

      if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        throw new Error("Camera access requires HTTPS connection");
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 }
        });

        const track = stream.getVideoTracks()[0];
        if (!track) {
          throw new Error("No camera device found");
        }

        stream.getTracks().forEach(track => track.stop());

        setShowCameraTest(true);
        toast({
          title: "Camera Test Started",
          description: "Camera access granted. Testing camera quality...",
        });
      } catch (permissionError: any) {
        let errorMessage = "Camera permission denied";

        if (permissionError.name === 'NotFoundError') {
          errorMessage = "No camera device found on this device";
        } else if (permissionError.name === 'NotAllowedError') {
          errorMessage = "Camera permission denied. Please enable camera access in your browser settings and try again";
        } else if (permissionError.name === 'NotReadableError') {
          errorMessage = "Camera is already in use by another application";
        } else if (permissionError.name === 'OverconstrainedError') {
          errorMessage = "Camera doesn't support the required resolution";
        }

        throw new Error(errorMessage);
      }
    } catch (error: any) {
      setCameraError(error.message);
      toast({
        title: "Camera Test Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCameraTesting(false);
    }
  };

  const handleCameraCapture = (imageData: string) => {
    setCameraTestComplete(true);
    toast({
      title: "Camera Test Successful",
      description: "Camera quality check completed successfully!",
    });

    setTimeout(() => {
      setShowCameraTest(false);
      setCameraTestComplete(false);
    }, 2000);
  };

  const handleCloseCameraTest = () => {
    setShowCameraTest(false);
    setCameraTestComplete(false);
    setCameraError(null);
  };

  const handleStartAppraisal = () => {
    localStorage.removeItem("currentAppraiser");
    localStorage.removeItem("jewelleryItems");
    setShowFacialRecognition(true);
  };

  const handleAppraiserIdentified = (appraiser: any) => {
    setShowFacialRecognition(false);
    toast({
      title: "Welcome Back!",
      description: `Starting new appraisal for ${appraiser.name}`,
    });
    navigate("/customer-image");
  };

  const handleNewAppraiserRequired = (capturedImage: string) => {
    setShowFacialRecognition(false);
    localStorage.setItem("newAppraiserPhoto", capturedImage);
    toast({
      title: "New Appraiser Registration",
      description: "Please provide your details to complete registration.",
    });
    navigate("/customer-image");
  };

  const handleFacialRecognitionCancel = () => {
    setShowFacialRecognition(false);
  };

  // Quick stats data (would come from API in production)
  const quickStats = [
    { label: "Today's Appraisals", value: 12, trend: { value: 8, isPositive: true }, icon: <Activity className="w-6 h-6 text-primary" /> },
    { label: "Pending Reviews", value: 3, icon: <Clock className="w-6 h-6 text-warning" /> },
    { label: "Completed", value: 9, trend: { value: 15, isPositive: true }, icon: <CheckCircle className="w-6 h-6 text-success" /> },
  ];

  // Workflow steps
  const workflowSteps = [
    { icon: User, title: "Appraiser ID", description: "Facial recognition verification", color: "primary" },
    { icon: Camera, title: "Customer Photo", description: "Capture customer identification", color: "primary" },
    { icon: Shield, title: "RBI Compliance", description: "Document gold items", color: "primary" },
    { icon: FlaskConical, title: "Purity Testing", description: "AI-powered analysis", color: "secondary" },
  ];

  return (
    <div>
      <Navigation />
      <ModernDashboardLayout notificationCount={2}>
        <div className="space-y-8 animate-fade-in">
          {/* Hero Section */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-primary/80 p-8 md:p-12">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full bg-secondary blur-3xl"></div>
            <div className="absolute -left-20 -bottom-20 w-60 h-60 rounded-full bg-white blur-2xl"></div>
          </div>

          <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <StatusBadge variant="live" size="sm">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
                    System Online
                  </span>
                </StatusBadge>
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white font-poppins leading-tight">
                Gold Guardian<span className="text-secondary"> Pro</span>
              </h1>
              <p className="text-white/80 text-lg max-w-xl">
                AI-powered gold jewelry appraisals optimized for banking workflows and RBI compliance.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  onClick={handleStartAppraisal}
                  variant="secondary"
                  size="lg"
                  className="gap-2 font-bold shadow-lg"
                >
                  <Play className="w-5 h-5" />
                  Start New Appraisal
                </Button>
                <Button
                  onClick={() => navigate("/records")}
                  variant="outline"
                  size="lg"
                  className="gap-2 border-white/30 text-white hover:bg-white/10 hover:text-white"
                >
                  <FileText className="w-5 h-5" />
                  View Records
                </Button>
              </div>
            </div>

            {/* Hero Image */}
            <div className="hidden lg:block">
              <div className="relative w-64 h-64">
                <div className="absolute inset-0 rounded-2xl bg-secondary/20 backdrop-blur-sm border border-white/20 overflow-hidden">
                  <img
                    src="/hero_jewelry_1.png"
                    alt="Gold Jewelry"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23FFDD44' width='200' height='200'/%3E%3Ctext fill='%23101585' font-family='sans-serif' font-size='24' x='50%25' y='50%25' text-anchor='middle' dy='.3em'%3EGold%3C/text%3E%3C/svg%3E";
                    }}
                  />
                </div>
                <Sparkles className="absolute -top-3 -right-3 w-8 h-8 text-secondary animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {quickStats.map((stat, index) => (
            <StatCard
              key={index}
              label={stat.label}
              value={stat.value}
              trend={stat.trend}
              icon={stat.icon}
            />
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Action Card */}
          <Card className="lg:col-span-2 overflow-hidden">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-secondary" />
                Appraisal Workflow
              </CardTitle>
              <CardDescription>
                Complete the following steps for a comprehensive gold assessment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {workflowSteps.map((step, index) => (
                  <div
                    key={index}
                    className="group flex flex-col items-center text-center p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                  >
                    <div className={`flex items-center justify-center w-12 h-12 rounded-xl mb-3 transition-colors ${step.color === "secondary"
                        ? "bg-secondary/20 text-secondary group-hover:bg-secondary group-hover:text-secondary-foreground"
                        : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
                      }`}>
                      <step.icon className="w-6 h-6" />
                    </div>
                    <h4 className="font-semibold text-sm text-foreground">{step.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Camera Check Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-secondary" />
                Camera Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-success/20">
                  <CheckCircle className="w-5 h-5 text-success" />
                </div>
                <div>
                  <p className="font-medium text-sm">Camera Ready</p>
                  <p className="text-xs text-muted-foreground">Last checked: Just now</p>
                </div>
              </div>
              <Button
                onClick={handleCameraQualityCheck}
                disabled={isCameraTesting}
                variant="outline"
                className="w-full gap-2"
              >
                <Camera className="w-4 h-4" />
                {isCameraTesting ? "Testing..." : "Run Quality Check"}
              </Button>
            </CardContent>
          </Card>
        </div>

        
      </div>

      {/* Camera Quality Test Dialog */}
      <Dialog open={showCameraTest} onOpenChange={handleCloseCameraTest}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" />
              Camera Quality Check
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {cameraError ? (
              <div className="text-center p-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-destructive/10 rounded-full flex items-center justify-center">
                  <X className="w-8 h-8 text-destructive" />
                </div>
                <h3 className="text-lg font-semibold text-destructive mb-2">Camera Test Failed</h3>
                <p className="text-muted-foreground mb-4">{cameraError}</p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={handleCloseCameraTest} variant="outline">
                    Close
                  </Button>
                  <Button onClick={handleCameraQualityCheck}>
                    Try Again
                  </Button>
                </div>
              </div>
            ) : cameraTestComplete ? (
              <div className="text-center p-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-success/10 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-success" />
                </div>
                <h3 className="text-lg font-semibold text-success mb-2">Camera Test Successful!</h3>
                <p className="text-muted-foreground">Your camera is working properly and ready for use.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-center mb-4">
                  <h3 className="text-lg font-semibold mb-2">Testing Camera Quality</h3>
                  <p className="text-muted-foreground">
                    Please allow camera access and capture a test photo to verify camera functionality.
                  </p>
                </div>

                <div className="border-2 border-dashed border-border rounded-xl p-4">
                  <LiveCamera
                    ref={cameraRef}
                    currentStepKey={currentStepKey}
                    onCapture={handleCameraCapture}
                    onClose={handleCloseCameraTest}
                  />
                </div>

                <div className="flex justify-between gap-3">
                  <Button onClick={handleCloseCameraTest} variant="outline">
                    Cancel Test
                  </Button>
                  <Button
                    onClick={() => cameraRef.current?.capturePhoto()}
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Test Capture
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Facial Recognition Dialog */}
      <Dialog open={showFacialRecognition} onOpenChange={handleFacialRecognitionCancel}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5 text-primary" />
              Appraiser Identification
            </DialogTitle>
          </DialogHeader>

          <FacialRecognition
            onAppraiserIdentified={handleAppraiserIdentified}
            onNewAppraiserRequired={handleNewAppraiserRequired}
            onCancel={handleFacialRecognitionCancel}
          />
        </DialogContent>
      </Dialog>
    </ModernDashboardLayout>
    </div>
  );
};

export default Dashboard;