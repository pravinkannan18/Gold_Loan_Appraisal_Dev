import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TenantProvider } from "./contexts/TenantContext";
import Index from "./pages/Index";
// import Auth from "./pages/Auth"; // Disabled - requires auth implementation
import Dashboard from "./pages/Dashboard";
import TenantManagement from "./pages/TenantManagement";
import Admin from "./pages/Admin";
import NewAppraisal from "./pages/NewAppraisal";
import { CustomerImage } from './pages/CustomerImage';
import { RBICompliance } from "./pages/RBICompliance";
import WebRTCPurityTesting from "./pages/WebRTCPurityTesting";
import { AppraisalSummary } from "./pages/AppraisalSummary";
import Records from "./pages/Records";
import CameraTest from "./pages/CameraTest";
import CameraSettings from "./pages/CameraSettings";
import BankBranchAdministration from "./pages/BankBranchAdministration";
import SuperAdmin from "./pages/SuperAdmin";
import NotFound from "./pages/NotFound";
import ForgotPassword from "./components/admin/ForgotPassword";
import ResetPassword from "./components/admin/ResetPassword";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <TenantProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            {/* <Route path="/auth" element={<Auth />} /> */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tenant-management" element={<TenantManagement />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/camera-settings" element={<CameraSettings />} />
            <Route path="/new-appraisal" element={<NewAppraisal />} />
            <Route path="/bank-branch-admin" element={<BankBranchAdministration />} />
            <Route path="/customer-image" element={<CustomerImage />} />
            <Route path="/rbi-compliance" element={<RBICompliance />} />
            <Route path="/purity-testing" element={<WebRTCPurityTesting />} />
            <Route path="/appraisal-summary" element={<AppraisalSummary />} />
            <Route path="/records" element={<Records />} />
            <Route path="/camera-test" element={<CameraTest />} />
            {/* Password Reset Routes */}
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            {/* Super Admin - Hidden route (no menu link), shows 404 for unauthorized users */}
            <Route path="/super-admin" element={<SuperAdmin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TenantProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
