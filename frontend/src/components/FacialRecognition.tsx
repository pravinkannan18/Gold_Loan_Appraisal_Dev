import { useMemo,useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, User, CheckCircle, X, UserPlus, Loader2 } from "lucide-react";
import LiveCamera, { LiveCameraRef } from "@/components/LiveCamera";
import { CameraSelector } from "@/components/CameraSelector";
import { toast } from "@/hooks/use-toast";
import { AppraiserProfile, AppraiserIdentificationData } from "@/types/facial-recognition";
import { useLocation } from "react-router-dom";

const stageToStepKey: Record<string, number> = {
  appraiser: 1,
  customer: 2,
  rbi: 3,
  individual: 4,
  purity: 5,
  summary: 6,
};

interface FacialRecognitionProps {
  onAppraiserIdentified: (appraiser: AppraiserProfile) => void;
  onNewAppraiserRequired: (capturedImage: string) => void;
  onCancel: () => void;
}

const FacialRecognition = ({ onAppraiserIdentified, onNewAppraiserRequired, onCancel }: FacialRecognitionProps) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<'identified' | 'new_appraiser' | null>(null);
  const [identifiedAppraiser, setIdentifiedAppraiser] = useState<AppraiserProfile | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const cameraRef = useRef<LiveCameraRef>(null);
  const location = useLocation();
  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;

  // Mock appraiser database - in real implementation, this would be from a backend API
  const mockAppraiserDatabase: AppraiserProfile[] = [
    {
      id: "APP001",
      name: "Dr. Sarah Johnson",
      licenseNumber: "LIC-2023-001",
      department: "Gold Verification",
      email: "sarah.johnson@bank.com",
      phone: "+1-555-0123",
      profileImage: "/api/placeholder/150/150",
      lastActive: "2024-01-15T09:30:00Z",
      appraisalsCompleted: 287,
      certification: "Certified Gold Appraiser Level III",
      faceEncoding: "mock_face_encoding_sarah" // In real app, this would be actual face encoding
    },
    {
      id: "APP002", 
      name: "Michael Chen",
      licenseNumber: "LIC-2023-002",
      department: "Quality Assurance",
      email: "michael.chen@bank.com",
      phone: "+1-555-0124",
      profileImage: "/api/placeholder/150/150",
      lastActive: "2024-01-14T15:45:00Z",
      appraisalsCompleted: 156,
      certification: "Certified Gold Appraiser Level II",
      faceEncoding: "mock_face_encoding_michael"
    },
    {
      id: "APP003",
      name: "Emma Rodriguez",
      licenseNumber: "LIC-2023-003", 
      department: "Regional Assessment",
      email: "emma.rodriguez@bank.com",
      phone: "+1-555-0125",
      profileImage: "/api/placeholder/150/150",
      lastActive: "2024-01-15T11:20:00Z",
      appraisalsCompleted: 342,
      certification: "Senior Gold Appraiser",
      faceEncoding: "mock_face_encoding_emma"
    }
  ];

  const simulateFacialAnalysis = async (imageData: string): Promise<AppraiserProfile | null> => {
    try {
      // Simulate progress during analysis with slower loading
      const progressSteps = [
        { progress: 10, message: "Initializing facial detection...", delay: 800 },
        { progress: 25, message: "Detecting facial features...", delay: 1200 },
        { progress: 45, message: "Extracting facial landmarks...", delay: 1000 },
        { progress: 65, message: "Analyzing facial patterns...", delay: 1200 },
        { progress: 80, message: "Matching against database...", delay: 1500 },
        { progress: 95, message: "Finalizing results...", delay: 800 }
      ];

      // Simulate progress updates
      for (const step of progressSteps) {
        setAnalysisMessage(step.message);
        await new Promise(resolve => setTimeout(resolve, step.delay));
        setAnalysisProgress(step.progress);
      }

      // Use the real backend API for facial recognition
      setAnalysisMessage("Connecting to recognition service...");
      const formData = new FormData();
      formData.append('image', imageData);

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/face/recognize`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      // Complete the progress
      setAnalysisMessage("Processing results...");
      setAnalysisProgress(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      if (!response.ok) {
        throw new Error(data.message || 'Recognition failed');
      }

      if (data.recognized && data.appraiser) {
        // Convert backend response to AppraiserProfile format
        return {
          id: data.appraiser.appraiser_id,
          appraiser_id: data.appraiser.appraiser_id, // Add this for compatibility
          name: data.appraiser.name,
          licenseNumber: data.appraiser.appraiser_id, // Use appraiser_id as license number
          department: "Gold Verification", // Default department
          email: `${data.appraiser.name.toLowerCase().replace(' ', '.')}@bank.com`, // Generate email
          phone: "+1-555-0000", // Default phone
          profileImage: "/api/placeholder/150/150",
          lastActive: new Date().toISOString(),
          appraisalsCompleted: 0, // Default value
          certification: "Certified Gold Appraiser",
          faceEncoding: "real_encoding" // Placeholder
        };
      }
      
      return null;
    } catch (error) {
      console.error('Facial recognition error:', error);
      throw error;
    }
  };

  const handleCameraCapture = async (imageData: string) => {
    setCapturedImage(imageData);
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisMessage('Preparing analysis...');

    try {
      toast({
        title: "Starting Facial Analysis",
        description: "Analyzing captured image for appraiser identification...",
      });

      const matchedAppraiser = await simulateFacialAnalysis(imageData);

      if (matchedAppraiser) {
        setIdentifiedAppraiser(matchedAppraiser);
        setAnalysisResult('identified');
        toast({
          title: "Appraiser Identified",
          description: `Welcome back, ${matchedAppraiser.name}!`,
        });
      } else {
        setAnalysisResult('new_appraiser');
        toast({
          title: "New Appraiser Detected", 
          description: "No match found in database. Please provide appraiser details.",
        });
      }
    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: "Failed to analyze facial features. Please try again.",
        variant: "destructive",
      });
      setAnalysisMessage('');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleProceedWithIdentifiedAppraiser = () => {
    if (identifiedAppraiser) {
      // Store appraiser info in localStorage
      localStorage.setItem("currentAppraiser", JSON.stringify({
        id: identifiedAppraiser.id,
        appraiser_id: identifiedAppraiser.appraiser_id || identifiedAppraiser.id, // Ensure appraiser_id is available
        name: identifiedAppraiser.name,
        licenseNumber: identifiedAppraiser.licenseNumber,
        department: identifiedAppraiser.department,
        email: identifiedAppraiser.email,
        phone: identifiedAppraiser.phone,
        identificationMethod: "facial_recognition",
        identificationTimestamp: new Date().toISOString(),
        profileImage: capturedImage // Use the captured image
      }));
      
      onAppraiserIdentified(identifiedAppraiser);
    }
  };

  const handleRegisterNewAppraiser = () => {
    if (capturedImage) {
      onNewAppraiserRequired(capturedImage);
    }
  };

  if (isAnalyzing) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Analyzing Facial Features</h3>
          <p className="text-gray-600 mb-2">
            Please wait while we identify the appraiser...
          </p>
          {analysisMessage && (
            <p className="text-sm text-blue-600 font-medium mb-4">
              {analysisMessage}
            </p>
          )}
          
          <div className="w-full max-w-md mx-auto">
            <div className="flex justify-between text-sm text-gray-500 mb-2">
              <span>Progress</span>
              <span>{analysisProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full transition-all duration-1000 ease-out"
                style={{ width: `${analysisProgress}%` }}
              />
            </div>
          </div>
        </div>

        {capturedImage && (
          <div className="flex justify-center">
            <div className="relative">
              <img 
                src={capturedImage} 
                alt="Captured for analysis" 
                className="w-32 h-32 rounded-lg object-cover border-2 border-blue-300"
              />
              <div className="absolute inset-0 border-2 border-blue-500 rounded-lg animate-pulse" />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (analysisResult === 'identified' && identifiedAppraiser) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h3 className="text-xl font-semibold text-green-700 mb-2">
            Appraiser Identified Successfully
          </h3>
          <p className="text-gray-600">
            Welcome back! Your identity has been verified.
          </p>
        </div>

        <Card className="max-w-md mx-auto">
          <CardHeader className="text-center pb-4">
            <div className="w-24 h-24 mx-auto mb-3 rounded-full overflow-hidden border-4 border-green-200">
              <img 
                src={capturedImage || identifiedAppraiser.profileImage} 
                alt={identifiedAppraiser.name}
                className="w-full h-full object-cover"
              />
            </div>
            <CardTitle className="text-lg">{identifiedAppraiser.name}</CardTitle>
            <Badge variant="secondary" className="mx-auto">
              {identifiedAppraiser.licenseNumber}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Department:</span>
              <span className="font-medium">{identifiedAppraiser.department}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Certification:</span>
              <span className="font-medium text-xs">{identifiedAppraiser.certification}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Appraisals:</span>
              <span className="font-medium">{identifiedAppraiser.appraisalsCompleted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Email:</span>
              <span className="font-medium text-xs">{identifiedAppraiser.email}</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-center">
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button 
            onClick={handleProceedWithIdentifiedAppraiser}
            className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
          >
            <CheckCircle className="w-4 h-4 mr-2" />
            Proceed with Appraisal
          </Button>
        </div>
      </div>
    );
  }

  if (analysisResult === 'new_appraiser') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-orange-100 rounded-full flex items-center justify-center">
            <UserPlus className="w-10 h-10 text-orange-600" />
          </div>
          <h3 className="text-xl font-semibold text-orange-700 mb-2">
            New Appraiser Detected
          </h3>
          <p className="text-gray-600">
            No matching profile found in our database. Please register as a new appraiser.
          </p>
        </div>

        {capturedImage && (
          <div className="flex justify-center">
            <div className="relative">
              <img 
                src={capturedImage} 
                alt="New appraiser photo" 
                className="w-32 h-32 rounded-lg object-cover border-2 border-orange-300"
              />
            </div>
          </div>
        )}

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h4 className="font-semibold text-orange-800 mb-2">Next Steps:</h4>
          <ul className="text-sm text-orange-700 space-y-1">
            <li>• You'll be directed to provide your professional details</li>
            <li>• Your facial profile will be registered for future logins</li>
            <li>• Administrative approval may be required</li>
          </ul>
        </div>

        <div className="flex gap-3 justify-center">
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button 
            onClick={handleRegisterNewAppraiser}
            className="bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Register New Appraiser
          </Button>
        </div>
      </div>
    );
  }

  // Initial camera capture state
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
          <User className="w-10 h-10 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Appraiser Identification</h3>
        <p className="text-gray-600">
          Please position your face in the camera and capture a clear photo for identification.
        </p>
      </div>

      {/* Camera Selection */}
      <div className="mb-4">
        <CameraSelector
          onCameraSelect={setSelectedCameraId}
          selectedDeviceId={selectedCameraId}
          autoDetect={true}
        />
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
        <LiveCamera
          ref={cameraRef}
          currentStepKey={currentStepKey}
          selectedDeviceId={selectedCameraId}
          onCapture={handleCameraCapture}
          onClose={onCancel}
        />
      </div>

      <div className="flex justify-between gap-3">
        <Button onClick={onCancel} variant="outline">
          Cancel
        </Button>
        <Button 
          onClick={() => cameraRef.current?.capturePhoto()}
          className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
        >
          <Camera className="w-4 h-4 mr-2" />
          Capture & Identify
        </Button>
      </div>
    </div>
  );
};

export default FacialRecognition;