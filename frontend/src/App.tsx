import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
// import Auth from "./pages/Auth"; // Disabled - requires auth implementation
import Dashboard from "./pages/Dashboard";
import NewAppraisal from "./pages/NewAppraisal";
import { AppraiserDetails } from "./pages/AppraiserDetails";
import { CustomerImage } from './pages/CustomerImage';
import { RBICompliance } from "./pages/RBICompliance";
import { PurityTesting } from "./pages/PurityTesting";
import FastPurityTesting from "./pages/FastPurityTesting";
import AWSPurityTesting from "./pages/AWSPurityTesting";
import { AppraisalSummary } from "./pages/AppraisalSummary";
import Records from "./pages/Records";
import CameraTest from "./pages/CameraTest";
import CameraSettings from "./pages/CameraSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          {/* <Route path="/auth" element={<Auth />} /> */}
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/camera-settings" element={<CameraSettings />} />
          <Route path="/new-appraisal" element={<NewAppraisal />} />
          <Route path="/appraiser-details" element={<AppraiserDetails />} />
          <Route path="/customer-image" element={<CustomerImage />} />
          <Route path="/rbi-compliance" element={<RBICompliance />} />
          <Route path="/purity-testing" element={<PurityTesting />} />
          <Route path="/purity-testing-fast" element={<FastPurityTesting />} />
          <Route path="/purity-testing-aws" element={<AWSPurityTesting />} />
          <Route path="/appraisal-summary" element={<AppraisalSummary />} />
          <Route path="/records" element={<Records />} />
          <Route path="/camera-test" element={<CameraTest />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
