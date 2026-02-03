import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Home,
  Download,
  User,
  Camera,
  Shield,
  FlaskConical,
  CheckCircle,
  MapPin,
  Globe,
  Loader2,
  AlertCircle,
  Clock
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { ModernDashboardLayout } from '@/components/layouts/ModernDashboardLayout';
import { cn } from '@/lib/utils';
import { StepIndicator } from '../components/journey/StepIndicator';
import { formatTimestamp, clearAppraisalData, showToast } from '../lib/utils';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';

interface AppraiserData {
  id: string;
  appraiser_id: string;
  name: string;
  photo: string;
}

interface JewelleryItemData {
  itemNumber: number;
  image: string;
}

interface RBIData {
  overallImages: Array<{
    id: number;
    image: string;
    timestamp: string;
  }>;
  totalItems: number;
  capturedItems: Array<{
    itemNumber: number;
    image: string;
  }>;
  captureMethod: 'individual' | 'overall';
  timestamp: string;
}

interface PurityResult {
  rubbingCompleted: boolean;
  acidCompleted: boolean;
  detectedActivities: Array<{
    activity: 'rubbing' | 'acid_testing';
    confidence: number;
    timestamp: number;
  }>;
  timestamp: string;
}


export function AppraisalSummary() {
  const navigate = useNavigate();
  const [appraiser, setAppraiser] = useState<AppraiserData | null>(null);
  const [customerFront, setCustomerFront] = useState('');
  const [customerSide, setCustomerSide] = useState('');
  const [jewelleryItems, setJewelleryItems] = useState<JewelleryItemData[]>([]);
  const [rbiData, setRbiData] = useState<RBIData | null>(null);
  const [purityResults, setPurityResults] = useState<PurityResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true); // Track initial page loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gpsData, setGpsData] = useState<{
    latitude: number;
    longitude: number;
    source: string;
    address: string;
    timestamp: string;
    map_image?: string;
  } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(true);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const fetchGPS = useCallback(async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/gps/location`, {
        credentials: 'include', // if you use auth
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGpsData(data);
    } catch (err: any) {
      console.error('GPS fetch error:', err);
      setGpsError(err.message || 'Failed to get location');
    } finally {
      setGpsLoading(false);
    }
  }, []);
  useEffect(() => {
    const loadData = async () => {
      try {
        // Get session ID from localStorage
        const sessionId = localStorage.getItem('appraisal_session_id');

        if (!sessionId) {
          console.error('No session ID found');
          showToast('Session not found. Please start from the beginning.', 'error');
          navigate('/customer-image');
          return;
        }

        console.log('AppraisalSummary - Loading data from session:', sessionId);

        // Fetch all session data from API
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}`);

        if (!response.ok) {
          throw new Error('Failed to load session data');
        }

        const sessionData = await response.json();
        console.log('Session data loaded:', sessionData);

        // Extract and set appraiser data
        if (sessionData.appraiser_data) {
          const appraiserData = typeof sessionData.appraiser_data === 'string'
            ? JSON.parse(sessionData.appraiser_data)
            : sessionData.appraiser_data;
          setAppraiser({
            id: appraiserData.db_id || appraiserData.id,
            appraiser_id: appraiserData.id,
            name: appraiserData.name,
            photo: appraiserData.photo || appraiserData.image
          });
        } else {
          throw new Error('Missing appraiser data');
        }

        // Extract customer images
        if (sessionData.customer_front_image) {
          setCustomerFront(sessionData.customer_front_image);
        }
        if (sessionData.customer_side_image) {
          setCustomerSide(sessionData.customer_side_image);
        }

        // Extract RBI compliance data
        if (sessionData.rbi_compliance) {
          const rbiCompliance = typeof sessionData.rbi_compliance === 'string'
            ? JSON.parse(sessionData.rbi_compliance)
            : sessionData.rbi_compliance;

          setRbiData({
            overallImages: rbiCompliance.overall_images || [],
            totalItems: sessionData.total_items || rbiCompliance.total_items || 0,
            capturedItems: rbiCompliance.captured_items || [],
            captureMethod: rbiCompliance.capture_method || 'overall',
            timestamp: new Date().toISOString()
          });
        } else {
          // If missing but previously we had fallback logic, we should probably stick to error to be safe
          // Or at least log it. But to prevent white page, we must either set it or error.
          throw new Error('Missing RBI compliance data');
        }

        // Extract jewellery items
        if (sessionData.jewellery_items) {
          const items = typeof sessionData.jewellery_items === 'string'
            ? JSON.parse(sessionData.jewellery_items)
            : sessionData.jewellery_items;
          setJewelleryItems(items);
        }

        // Extract purity results
        if (sessionData.purity_results) {
          const purity = typeof sessionData.purity_results === 'string'
            ? JSON.parse(sessionData.purity_results)
            : sessionData.purity_results;

          // Handle multi-item purity results
          if (purity.items && Array.isArray(purity.items)) {
            // Aggregate results from all items
            const allRubbingCompleted = purity.items.every((item: any) => item.rubbingCompleted);
            const allAcidCompleted = purity.items.every((item: any) => item.acidCompleted);

            setPurityResults({
              rubbingCompleted: allRubbingCompleted,
              acidCompleted: allAcidCompleted,
              detectedActivities: [],
              timestamp: purity.completed_at || new Date().toISOString()
            });
          } else {
            setPurityResults({
              rubbingCompleted: purity.rubbingCompleted || false,
              acidCompleted: purity.acidCompleted || false,
              detectedActivities: purity.detectedActivities || [],
              timestamp: purity.timestamp || new Date().toISOString()
            });
          }
        } else {
          console.warn('No purity data found');
          showToast('Please complete purity testing first', 'error');
          navigate('/purity-testing');
          return;
        }

        // Fetch GPS data
        fetchGPS();

        setPageLoading(false);
      } catch (error: any) {
        console.error('Error loading session data:', error);
        setLoadError(error?.message || 'Failed to load appraisal data');
        setPageLoading(false);
        showToast('Failed to load appraisal data', 'error');
      }
    };

    loadData();
  }, [navigate, fetchGPS]);



  const handleExportPDF = async () => {
    try {
      console.log('=== EXPORTING PDF ===');

      if (!appraiser || !rbiData || !purityResults) {
        showToast('Missing appraisal data', 'error');
        return;
      }

      // Create appraisal summary for QR code
      const appraisalSummary = {
        appraisalId: appraiser.appraiser_id,
        appraiserName: appraiser.name,
        timestamp: new Date().toISOString(),
        totalItems: rbiData.totalItems,
        purityTestingCompleted: purityResults ? (purityResults.rubbingCompleted || purityResults.acidCompleted) : false,
        rubbingTest: purityResults?.rubbingCompleted ? 'Completed' : 'Not Completed',
        acidTest: purityResults?.acidCompleted ? 'Completed' : 'Not Completed',
      };

      // Generate QR code
      const qrDataString = JSON.stringify(appraisalSummary);
      const qrCodeDataUrl = await QRCode.toDataURL(qrDataString, {
        width: 300,
        margin: 2,
      });

      // Create PDF
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      let yPosition = 20;

      // Title
      pdf.setFontSize(22);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Gold Loan Appraisal Report', pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;

      // Horizontal line
      pdf.setLineWidth(0.5);
      pdf.line(20, yPosition, pageWidth - 20, yPosition);
      yPosition += 10;

      // Appraiser Information
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Appraiser Information', 20, yPosition);
      yPosition += 8;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Name: ${appraiser.name}`, 20, yPosition);
      yPosition += 6;
      pdf.text(`ID: ${appraiser.appraiser_id}`, 20, yPosition);
      yPosition += 6;
      pdf.text(`Date: ${new Date().toLocaleString()}`, 20, yPosition);
      yPosition += 12;

      // Customer Information
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Customer Information', 20, yPosition);
      yPosition += 8;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Front Image: Captured`, 20, yPosition);
      yPosition += 6;
      pdf.text(`Side Image: Captured`, 20, yPosition);
      yPosition += 12;

      // Jewellery Items
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Jewellery Items', 20, yPosition);
      yPosition += 8;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Total Items: ${jewelleryItems.length}`, 20, yPosition);
      yPosition += 6;

      jewelleryItems.forEach((item, index) => {
        pdf.text(`  ${index + 1}. Item ${item.itemNumber}`, 25, yPosition);
        yPosition += 6;
      });
      yPosition += 6;

      // RBI Compliance
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('RBI Compliance Image', 20, yPosition);
      yPosition += 8;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Overall Image: Captured`, 20, yPosition);
      yPosition += 6;
      pdf.text(`Compliance Date: ${new Date(rbiData.timestamp).toLocaleString()}`, 20, yPosition);
      yPosition += 12;

      // Purity Testing
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Purity Testing', 20, yPosition);
      yPosition += 8;

      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'normal');
      if (purityResults) {
        pdf.text(`Rubbing Test: ${purityResults.rubbingCompleted ? 'Completed' : 'Not Completed'}`, 20, yPosition);
        yPosition += 6;
        pdf.text(`Acid Test: ${purityResults.acidCompleted ? 'Completed' : 'Not Completed'}`, 20, yPosition);
        yPosition += 6;
        pdf.text(`Total Detections: ${purityResults.detectedActivities?.length || 0}`, 20, yPosition);
        yPosition += 6;
      } else {
        pdf.text(`No purity test results available`, 20, yPosition);
        yPosition += 6;
      }
      yPosition += 12;

      // QR Code Section
      pdf.setFontSize(16);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Appraisal QR Code', 20, yPosition);
      yPosition += 8;

      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Scan this QR code to view appraisal summary:', 20, yPosition);
      yPosition += 10;

      // Add QR code image
      const qrSize = 60;
      pdf.addImage(qrCodeDataUrl, 'PNG', 20, yPosition, qrSize, qrSize);
      yPosition += qrSize + 10;

      // Footer
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'italic');
      pdf.text('This is a computer-generated document.', pageWidth / 2, pageHeight - 15, { align: 'center' });
      pdf.text(`Generated on: ${new Date().toLocaleString()}`, pageWidth / 2, pageHeight - 10, { align: 'center' });

      // Save PDF
      const fileName = `appraisal-${appraiser.appraiser_id}.pdf`;
      pdf.save(fileName);

      console.log('✓ PDF exported successfully');
      showToast('PDF exported successfully!', 'success');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      showToast('Failed to export PDF', 'error');
    }
  };

  const handleFinish = async () => {
    setIsLoading(true);

    try {
      // Get session ID
      const sessionId = localStorage.getItem('appraisal_session_id');
      if (!sessionId) {
        throw new Error('No active session found');
      }

      // Finalize session on backend
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/session/${sessionId}/finalize`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to finalize session on server');
      }

      // Save LIGHTWEIGHT record to localStorage (for recent history list only)
      // EXCLUDING all images to prevent QuotaExceededError
      const minimalRecord = {
        id: Date.now(),
        session_id: sessionId,
        appraiser_name: appraiser?.name || 'Unknown',
        appraiser_id: appraiser?.appraiser_id || '',
        total_items: jewelleryItems.length,
        purity_testing: purityResults ? `Rubbing: ${purityResults.rubbingCompleted ? 'Yes' : 'No'}, Acid: ${purityResults.acidCompleted ? 'Yes' : 'No'}` : 'Not completed',
        created_at: new Date().toISOString(),
        status: 'completed',
        // NO IMAGES stored locally
      };

      // Get existing records and add new one
      const existingRecords = JSON.parse(localStorage.getItem('appraisalRecords') || '[]');
      existingRecords.unshift(minimalRecord);

      // Keep only last 20 records
      if (existingRecords.length > 20) {
        existingRecords.splice(20);
      }

      localStorage.setItem('appraisalRecords', JSON.stringify(existingRecords));

      showToast('Appraisal completed and saved successfully!', 'success');
      clearAppraisalData();
      navigate('/');
    } catch (error: any) {
      console.error('Error completing appraisal:', error);
      showToast(error.message || 'Failed to complete appraisal', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading state while fetching data
  if (pageLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
          <p className="text-lg font-semibold text-muted-foreground">Loading appraisal data...</p>
        </div>
      </div>
    );
  }

  // Show error state if loading failed
  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6 text-center space-y-4">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-destructive" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-destructive">Failed to load data</h3>
              <p className="text-muted-foreground mt-2">{loadError}</p>
            </div>
            <Button
              onClick={() => navigate('/customer-image')}
              variant="destructive"
            >
              Start New Appraisal
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!appraiser || !rbiData || !purityResults) {
    return null;
  }

  return (
    <ModernDashboardLayout
      title="Appraisal Summary"
      showSidebar
      headerContent={<StepIndicator currentStep={5} />}
    >
      <div className="max-w-7xl mx-auto space-y-6 pb-20">

        {/* Header Actions */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-poppins text-primary">Final Review</h2>
            <p className="text-muted-foreground">Review and finalize the appraisal documentation</p>
          </div>
          <Button onClick={handleExportPDF} className="gap-2 shadow-md">
            <Download className="w-4 h-4" />
            Export PDF Report
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Appraiser Info */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="p-2 bg-primary/10 rounded-lg">
                <User className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Appraiser Information</CardTitle>
                <CardDescription>Verified appraiser details</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Name</p>
                  <p className="font-semibold text-lg">{appraiser.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">ID</p>
                  <p className="font-mono text-sm bg-muted px-2 py-1 rounded inline-block">{appraiser.appraiser_id}</p>
                </div>
              </div>
              <div className="flex justify-center md:justify-end">
                {appraiser.photo ? (
                  <img src={appraiser.photo} alt="Appraiser" className="w-24 h-24 object-cover rounded-xl border-2 border-primary/20 shadow-sm" />
                ) : (
                  <div className="w-24 h-24 bg-muted rounded-xl flex items-center justify-center text-muted-foreground text-xs">No Photo</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Customer Images */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="p-2 bg-secondary/10 rounded-lg">
                <User className="w-6 h-6 text-secondary-foreground" />
              </div>
              <div>
                <CardTitle className="text-lg">Customer Documentation</CardTitle>
                <CardDescription>Identity verification images</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Front View</p>
                <div className="aspect-[4/3] rounded-lg overflow-hidden border bg-muted">
                  <img src={customerFront} alt="Front" className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                </div>
              </div>
              {customerSide && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Side View</p>
                  <div className="aspect-[4/3] rounded-lg overflow-hidden border bg-muted">
                    <img src={customerSide} alt="Side" className="w-full h-full object-cover" onError={(e) => e.currentTarget.style.display = 'none'} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RBI Compliance */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">RBI Compliance</CardTitle>
              <CardDescription>Jewellery inventory and compliance check</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Items</p>
                <p className="text-2xl font-bold font-poppins text-primary">{rbiData.totalItems}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-sm text-muted-foreground">Compliance Date</p>
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  {formatTimestamp(new Date(rbiData.timestamp))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Camera className="w-4 h-4" />
                Captured Items ({jewelleryItems.length})
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                {jewelleryItems.map((item) => (
                  <div key={item.itemNumber} className="space-y-1 group">
                    <div className="aspect-square rounded-lg overflow-hidden border bg-muted relative">
                      <img src={item.image} alt={`Item ${item.itemNumber}`} className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                    </div>
                    <p className="text-[10px] text-center font-medium text-muted-foreground">Item {item.itemNumber}</p>
                  </div>
                ))}
              </div>
            </div>

            {rbiData.overallImages && rbiData.overallImages.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Overall Collection Images ({rbiData.overallImages.length})</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {rbiData.overallImages.map((img, index) => (
                    <div key={img.id || index} className="space-y-1">
                      <div className="h-32 rounded-lg overflow-hidden border bg-muted">
                        <img src={img.image} alt={`Overall ${index + 1}`} className="w-full h-full object-cover" />
                      </div>
                      <p className="text-[10px] text-center text-muted-foreground">Image {index + 1}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Purity Results (2/3) */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <FlaskConical className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Purity Testing</CardTitle>
                <CardDescription>AI-verified purity analysis results</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {purityResults ? (
                <div className="space-y-6">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className={cn(
                      "p-4 rounded-xl border-2 flex items-center justify-between transition-all",
                      purityResults.rubbingCompleted ? "bg-success/5 border-success/20" : "bg-muted border-border"
                    )}>
                      <div>
                        <p className="text-sm font-semibold mb-1">Rubbing Test</p>
                        <p className="text-xs text-muted-foreground">Streak verification</p>
                      </div>
                      <StatusBadge variant={purityResults.rubbingCompleted ? "success" : "default"}>
                        {purityResults.rubbingCompleted ? "Completed" : "Pending"}
                      </StatusBadge>
                    </div>
                    <div className={cn(
                      "p-4 rounded-xl border-2 flex items-center justify-between transition-all",
                      purityResults.acidCompleted ? "bg-success/5 border-success/20" : "bg-muted border-border"
                    )}>
                      <div>
                        <p className="text-sm font-semibold mb-1">Acid Test</p>
                        <p className="text-xs text-muted-foreground">Chemical verification</p>
                      </div>
                      <StatusBadge variant={purityResults.acidCompleted ? "success" : "default"}>
                        {purityResults.acidCompleted ? "Completed" : "Pending"}
                      </StatusBadge>
                    </div>
                  </div>

                  {purityResults.detectedActivities && purityResults.detectedActivities.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-muted-foreground">Activity Log</p>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                        {purityResults.detectedActivities.map((activity, index) => (
                          <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border text-sm">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-2 rounded-full bg-blue-500" />
                              <span className="font-medium">
                                {activity.activity === 'rubbing' ? 'Rubbing Detected' : 'Acid Application Detected'}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground font-mono">
                              {new Date(activity.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No purity test results available</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* GPS Data (1/3) */}
          <Card>
            <CardHeader className="flex flex-row items-center gap-4 pb-2">
              <div className="p-2 bg-teal-500/10 rounded-lg">
                <MapPin className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Location</CardTitle>
                <CardDescription>Geo-verification</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {gpsLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Getting location...
                </div>
              ) : gpsError ? (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  {gpsError}
                </div>
              ) : gpsData ? (
                <>
                  <div className="aspect-square rounded-lg overflow-hidden border bg-muted relative">
                    {gpsData.map_image ? (
                      <img src={gpsData.map_image} alt="Map" className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Map Unavailable</div>
                    )}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Coordinates</p>
                        <p className="text-muted-foreground text-xs font-mono">{gpsData.latitude.toFixed(6)}, {gpsData.longitude.toFixed(6)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Globe className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Address</p>
                        <p className="text-muted-foreground text-xs">{gpsData.address || "Unknown Address"}</p>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground pt-2 border-t text-center">
                      Timestamp: {formatTimestamp(new Date(gpsData.timestamp))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">No GPS Data</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Action Footer */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-md border-t z-40 shadow-up">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <Button variant="ghost" onClick={() => navigate('/purity-testing')} className="text-muted-foreground">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Tests
            </Button>

            <Button
              onClick={handleFinish}
              disabled={isLoading}
              size="lg"
              className="shadow-lg shadow-success/20 hover:shadow-success/30 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 border-0"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Finalizing...</>
              ) : (
                <><Home className="w-4 h-4 mr-2" /> Submit & Finish Appraisal</>
              )}
            </Button>
          </div>
        </div>

      </div>
    </ModernDashboardLayout>
  );
}
