import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, User, CheckCircle, X, UserPlus, Loader2, Search, Building, MapPin, AlertCircle, ArrowLeft } from "lucide-react";
import LiveCamera, { LiveCameraRef } from "@/components/LiveCamera";
import { CameraSelector } from "@/components/CameraSelector";
import { toast } from "@/hooks/use-toast";
import { AppraiserProfile, AppraiserIdentificationData } from "@/types/facial-recognition";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

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
  
  // Bank and Branch selection state
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [banks, setBanks] = useState<Array<{id: number, bank_name: string}>>([]);
  const [branches, setBranches] = useState<Array<{id: number, branch_name: string, bank_id: number}>>([]);
  const [filteredBranches, setFilteredBranches] = useState<Array<{id: number, branch_name: string, bank_id: number}>>([]);
  const [appraiserName, setAppraiserName] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');
  const [verifiedAppraiser, setVerifiedAppraiser] = useState<any>(null);
  const [currentStep, setCurrentStep] = useState<'verify' | 'capture'>('verify');
  
  // Initialize selectedCameraId from localStorage saved setting
  const [selectedCameraId, setSelectedCameraId] = useState<string>(() => {
    const savedDeviceId = localStorage.getItem('camera_appraiser-identification');
    if (savedDeviceId) {
      console.log('📹 Loaded saved camera for appraiser-identification:', savedDeviceId);
    }
    return savedDeviceId || '';
  });
  const cameraRef = useRef<LiveCameraRef>(null);
  const location = useLocation();
  const stage = useMemo(() => new URLSearchParams(location.search).get("stage") || "customer", [location.search]);
  const currentStepKey = stageToStepKey[stage] || 1;

  // Load banks and branches data
  useEffect(() => {
    const fetchBanksAndBranches = async () => {
      try {
        const [banksResponse, branchesResponse] = await Promise.all([
          fetch(`${import.meta.env.VITE_API_URL}/api/admin/banks`),
          fetch(`${import.meta.env.VITE_API_URL}/api/admin/branches`)
        ]);
        
        if (banksResponse.ok && branchesResponse.ok) {
          const banksData = await banksResponse.json();
          const branchesData = await branchesResponse.json();
          setBanks(banksData.banks || []);
          setBranches(branchesData.branches || []);
        }
      } catch (error) {
        console.error('Error loading banks/branches:', error);
        toast({
          title: "Error",
          description: "Failed to load banks and branches data",
          variant: "destructive"
        });
      }
    };
    
    fetchBanksAndBranches();
  }, []);

  // Filter branches when bank selection changes
  useEffect(() => {
    if (selectedBankId) {
      const bankId = parseInt(selectedBankId);
      const filtered = branches.filter(branch => branch.bank_id === bankId);
      setFilteredBranches(filtered);
      setSelectedBranchId(''); // Reset branch selection
    } else {
      setFilteredBranches([]);
      setSelectedBranchId('');
    }
  }, [selectedBankId, branches]);

  const handleVerifyAppraiser = async () => {
    if (!appraiserName.trim() || !selectedBankId || !selectedBranchId) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setIsVerifying(true);
    setVerificationStatus('idle');
    setVerificationMessage('');

    try {
      // Verify appraiser is registered in the selected bank/branch
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/verify-appraiser`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: appraiserName.trim(),
          bank_id: parseInt(selectedBankId),
          branch_id: parseInt(selectedBranchId)
        })
      });

      const data = await response.json();

      if (response.ok && data.exists) {
        setVerificationStatus('success');
        setVerificationMessage('Appraiser verified successfully! Please proceed to capture photo.');
        setVerifiedAppraiser(data.appraiser);
        
        toast({
          title: "Verification Success",
          description: `Appraiser found in ${data.appraiser.bank_name} - ${data.appraiser.branch_name}`,
        });
        
        // Automatically move to camera step after short delay
        setTimeout(() => {
          setCurrentStep('capture');
        }, 1500);
      } else {
        setVerificationStatus('error');
        setVerificationMessage('Appraiser not found in the selected bank/branch. Only branch admin can add appraisers to this system.');
        
        toast({
          title: "Verification Failed",
          description: "Appraiser not registered in selected bank/branch",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error verifying appraiser:', error);
      setVerificationStatus('error');
      setVerificationMessage('Failed to verify appraiser. Please try again.');
      
      toast({
        title: "Error",
        description: "Verification failed. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsVerifying(false);
    }
  };

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

  const simulateFacialAnalysis = async (imageData: string, appraiserData?: any): Promise<AppraiserProfile | null> => {
    try {
      // Use passed appraiser data or fall back to state
      const appraiser = appraiserData || verifiedAppraiser;
      
      // Get bank name for display
      const bankName = appraiser?.bank_name || banks.find(b => b.id === parseInt(selectedBankId))?.bank_name || 'database';
      
      // Simulate progress during analysis with slower loading
      const progressSteps = [
        { progress: 40, message: "Initializing facial detection...", delay: 800 },
        { progress: 50, message: "Detecting facial features...", delay: 1000 },
        { progress: 60, message: "Extracting facial landmarks...", delay: 800 },
        { progress: 75, message: "Analyzing facial patterns...", delay: 1000 },
        { progress: 85, message: `Matching against ${bankName} database...`, delay: 1200 },
        { progress: 95, message: "Finalizing results...", delay: 600 }
      ];

      // Simulate progress updates
      for (const step of progressSteps) {
        setAnalysisMessage(step.message);
        await new Promise(resolve => setTimeout(resolve, step.delay));
        setAnalysisProgress(step.progress);
      }

      // Check if appraiser data is available
      if (!appraiser) {
        throw new Error('Appraiser data not available. Please verify appraiser first.');
      }

      // Use the real backend API for facial recognition with bank/branch context
      setAnalysisMessage("Connecting to recognition service...");
      
      // Use /api/face/identify instead of /recognize for bank/branch-specific verification
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/face/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: imageData,
          appraiser_id: appraiser.appraiser_id || appraiser.id,
          name: appraiser.name,
          bank_id: parseInt(selectedBankId),
          branch_id: parseInt(selectedBranchId)
        })
      });

      const data = await response.json();

      // Complete the progress
      setAnalysisMessage("Processing results...");
      setAnalysisProgress(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      if (!response.ok) {
        throw new Error(data.detail || data.message || 'Recognition failed');
      }

      // Handle error responses that come with 200 status
      if (data.error) {
        console.warn('Face recognition issue:', data.error, data.message);
        // Return null to trigger "new appraiser" flow, but with a specific message
        if (data.error === 'no_face_detected') {
          throw new Error(data.message || 'No face detected. Please position your face clearly in the camera.');
        } else if (data.error === 'multiple_faces') {
          throw new Error(data.message || 'Multiple faces detected. Please ensure only one person is in the frame.');
        }
        // For other errors like service_offline, treat as new appraiser
        return null;
      }

      // Check if face matches (using 'matches' from identify endpoint)
      if (data.matches && data.appraiser) {
        // Convert backend response to AppraiserProfile format with bank/branch info
        return {
          id: data.appraiser.appraiser_id,
          appraiser_id: data.appraiser.appraiser_id,
          name: data.appraiser.name,
          licenseNumber: data.appraiser.appraiser_id,
          department: "Gold Verification", // Default department
          email: data.appraiser.email || "",
          phone: data.appraiser.phone || "",
          profileImage: data.appraiser.image_data || "/api/placeholder/150/150",
          lastActive: new Date().toISOString(),
          appraisalsCompleted: data.appraiser.appraisals_completed || 0,
          certification: "Certified Gold Appraiser",
          faceEncoding: "real_encoding",
          confidence: data.confidence || 0,
          bank: appraiser?.bank_name || banks.find(b => b.id === parseInt(selectedBankId))?.bank_name || "",
          branch: appraiser?.branch_name || filteredBranches.find(b => b.id === parseInt(selectedBranchId))?.branch_name || "",
          bank_id: parseInt(selectedBankId),
          branch_id: parseInt(selectedBranchId)
        };
      }

      // Face didn't match with sufficient confidence
      if (data.confidence !== undefined && data.confidence < 50) {
        throw new Error(`Face verification failed. Confidence: ${data.confidence.toFixed(1)}%. Please try again with better lighting.`);
      }

      return null;
    } catch (error) {
      console.error('Facial recognition error:', error);
      throw error;
    }
  };

  const handleCameraCapture = async (imageData: string) => {
    // First verify appraiser exists in the selected bank/branch
    if (!appraiserName.trim() || !selectedBankId || !selectedBranchId) {
      toast({
        title: "Missing Information",
        description: "Please enter your name and select bank/branch before capturing",
        variant: "destructive"
      });
      return;
    }

    setCapturedImage(imageData);
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisMessage('Verifying appraiser registration...');

    try {
      // Step 1: Verify appraiser is registered in the selected bank/branch
      setAnalysisProgress(10);
      const verifyResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/verify-appraiser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: appraiserName.trim(),
          bank_id: parseInt(selectedBankId),
          branch_id: parseInt(selectedBranchId)
        })
      });

      const verifyData = await verifyResponse.json();
      setAnalysisProgress(30);

      if (!verifyResponse.ok || !verifyData.exists) {
        setIsAnalyzing(false);
        setVerificationStatus('error');
        setVerificationMessage('Appraiser not found in the selected bank/branch. Only branch admin can add appraisers to this system.');
        toast({
          title: "Verification Failed",
          description: "Appraiser not registered in selected bank/branch",
          variant: "destructive"
        });
        return;
      }

      // Store verified appraiser data for facial recognition
      const verifiedAppraiserData = verifyData.appraiser;
      setVerifiedAppraiser(verifiedAppraiserData);
      setAnalysisMessage('Appraiser verified. Starting facial recognition...');

      toast({
        title: "Starting Facial Analysis",
        description: "Analyzing captured image for appraiser identification...",
      });

      // Step 2: Perform facial recognition against the verified appraiser
      // Pass the appraiser data directly to avoid async state issues
      const matchedAppraiser = await simulateFacialAnalysis(imageData, verifiedAppraiserData);

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
    } catch (error: any) {
      const errorMessage = error?.message || "Failed to analyze facial features. Please try again.";
      toast({
        title: "Analysis Failed",
        description: errorMessage,
        variant: "destructive",
      });
      setAnalysisMessage('');
      // Reset to camera view so user can try again
      setAnalysisResult(null);
      setCapturedImage(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleProceedWithIdentifiedAppraiser = async () => {
    if (identifiedAppraiser) {
      try {
        // Create a new session for this appraisal workflow
        console.log('=== CREATING SESSION FOR FACIAL RECOGNITION LOGIN ===');
        const sessionResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/session/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!sessionResponse.ok) {
          throw new Error('Failed to create appraisal session');
        }

        const sessionData = await sessionResponse.json();
        const sessionId = sessionData.session_id;
        console.log('Session created:', sessionId);

        // Save appraiser data to session
        const appraiserData = {
          name: identifiedAppraiser.name,
          id: identifiedAppraiser.appraiser_id || identifiedAppraiser.id,
          image: capturedImage || '',
          timestamp: new Date().toISOString(),
          photo: capturedImage || ''
        };

        const saveResponse = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/appraiser`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(appraiserData)
        });

        if (!saveResponse.ok) {
          throw new Error('Failed to save appraiser data to session');
        }

        console.log('Appraiser data saved to session');

        // Store session_id in localStorage
        localStorage.setItem('appraisal_session_id', sessionId);

        // Store appraiser info in localStorage (minimal data for quick access)
        localStorage.setItem("currentAppraiser", JSON.stringify({
          id: identifiedAppraiser.id,
          appraiser_id: identifiedAppraiser.appraiser_id || identifiedAppraiser.id,
          name: identifiedAppraiser.name,
          licenseNumber: identifiedAppraiser.licenseNumber,
          department: identifiedAppraiser.department,
          email: identifiedAppraiser.email,
          phone: identifiedAppraiser.phone,
          bank: identifiedAppraiser.bank || "",
          branch: identifiedAppraiser.branch || "",
          identificationMethod: "facial_recognition",
          identificationTimestamp: new Date().toISOString(),
          session_id: sessionId,
          photo: capturedImage // Keep photo for local display
        }));

        onAppraiserIdentified(identifiedAppraiser);
      } catch (error) {
        console.error('Error creating session:', error);
        toast({
          title: "Error",
          description: "Failed to start appraisal session. Please try again.",
          variant: "destructive",
        });
      }
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

  // Initial appraiser verification state
  if (currentStep === 'verify') {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
            <User className="w-10 h-10 text-blue-600" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Appraiser Identification</h3>
          <p className="text-gray-600">
            Select your bank and branch, then capture your photo for facial recognition.
          </p>
        </div>

        {/* Bank and Branch Selection */}
        <div className="space-y-4">
          {/* Full Name Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={appraiserName}
              onChange={(e) => setAppraiserName(e.target.value)}
              placeholder="Enter your full name"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Bank and Branch Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                Bank <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={selectedBankId}
                  onChange={(e) => setSelectedBankId(e.target.value)}
                  className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select Bank</option>
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id.toString()}>
                      {bank.bank_name}
                    </option>
                  ))}
                </select>
                {selectedBankId && <div className="absolute right-3 top-1/2 -translate-y-1/2"><Building className="w-4 h-4 text-muted-foreground" /></div>}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                Branch <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  disabled={!selectedBankId}
                  className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Select Branch</option>
                  {filteredBranches.map((branch) => (
                    <option key={branch.id} value={branch.id.toString()}>
                      {branch.branch_name}
                    </option>
                  ))}
                </select>
                {selectedBranchId && <div className="absolute right-3 top-1/2 -translate-y-1/2"><MapPin className="w-4 h-4 text-muted-foreground" /></div>}
              </div>
            </div>
          </div>
        </div>

        {/* Live Camera Section */}
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-4">
          <LiveCamera
            ref={cameraRef}
            currentStepKey={currentStepKey}
            selectedDeviceId={selectedCameraId}
            onCapture={handleCameraCapture}
            onClose={onCancel}
          />
        </div>

        {/* Verification Status Message */}
        {verificationMessage && (
          <div className={cn(
            "p-3 rounded-lg text-sm flex items-start gap-2",
            verificationStatus === 'success' ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
          )}>
            {verificationStatus === 'success' ? (
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            )}
            <span>{verificationMessage}</span>
          </div>
        )}

        <div className="flex justify-between gap-3">
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button
            onClick={() => cameraRef.current?.capturePhoto()}
            disabled={!appraiserName.trim() || !selectedBankId || !selectedBranchId}
            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
          >
            <Camera className="w-4 h-4 mr-2" />
            Capture & Identify
          </Button>
        </div>
      </div>
    );
  }

  // This step is no longer needed since camera is now in the verify step
  // Camera capture state (after verification)
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
          <User className="w-10 h-10 text-blue-600" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Facial Recognition</h3>
        <p className="text-gray-600">
          Please position your face in the camera and capture a clear photo for identification.
        </p>
        {verifiedAppraiser && (
          <p className="text-sm text-muted-foreground mt-2">
            Verifying against: <span className="font-medium">{verifiedAppraiser.name}</span> at {verifiedAppraiser.bank_name} - {verifiedAppraiser.branch_name}
          </p>
        )}
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
        <Button onClick={() => setCurrentStep('verify')} variant="outline">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Verification
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