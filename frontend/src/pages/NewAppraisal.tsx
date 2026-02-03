import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuroraLayout } from "@/components/layouts/AuroraLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TenantSelector } from "@/components/tenant";
import { useTenant } from "@/contexts/TenantContext";
import { useTenantContext } from "@/hooks/useTenantHooks";
import { Bank, Branch, TenantUser, UserRole } from "@/types/tenant";
import { ChevronRight, User, Building2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const NewAppraisal = () => {
  const navigate = useNavigate();
  const { state } = useTenant();
  const { tenantContext, isValidTenantContext } = useTenantContext();
  const [selectedTenant, setSelectedTenant] = useState<{
    bank: Bank | null;
    branch: Branch | null;
    user: TenantUser | null;
  }>({
    bank: state.currentBank,
    branch: state.currentBranch,
    user: state.currentUser,
  });

  const handleTenantSelection = (selection: {
    bank: Bank | null;
    branch: Branch | null;
    user: TenantUser | null;
  }) => {
    setSelectedTenant(selection);
  };

  const handleStartAppraisal = () => {
    if (!selectedTenant.bank) {
      toast({
        title: "Bank Selection Required",
        description: "Please select a bank before starting the appraisal.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedTenant.user) {
      toast({
        title: "User Selection Required", 
        description: "Please select an appraiser before starting the appraisal.",
        variant: "destructive",
      });
      return;
    }

    // Store tenant context for the appraisal session
    const sessionContext = {
      bank_id: selectedTenant.bank.id,
      branch_id: selectedTenant.branch?.id,
      tenant_user_id: selectedTenant.user.id,
      bank_name: selectedTenant.bank.bank_name,
      branch_name: selectedTenant.branch?.branch_name,
      appraiser_name: selectedTenant.user.full_name,
      appraiser_role: selectedTenant.user.role,
    };

    localStorage.setItem('appraisalTenantContext', JSON.stringify(sessionContext));

    toast({
      title: "Starting New Appraisal",
      description: `Appraisal session started for ${selectedTenant.user.full_name} at ${selectedTenant.bank.bank_short_name}`,
    });

    // Navigate to appraiser details (or facial recognition)
    navigate("/customer-image");
  };

  const canStartAppraisal = selectedTenant.bank && selectedTenant.user;
  const appraiserRoles = [
    UserRole.SENIOR_APPRAISER,
    UserRole.GOLD_APPRAISER,
    UserRole.TRAINEE_APPRAISER
  ];

  return (
    <AuroraLayout>
      <div className="min-h-screen py-8 px-4 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_45%),_radial-gradient(circle_at_bottom,_rgba(14,165,233,0.18),_transparent_55%)]">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              Start New Appraisal
            </h1>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              Select the bank, branch, and appraiser to begin a new gold loan appraisal session
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Tenant Selection */}
            <div className="lg:col-span-2">
              <TenantSelector
                onSelectionChange={handleTenantSelection}
                roleFilter={appraiserRoles}
                title="Appraisal Context"
                description="Select the organizational context for this appraisal session"
              />
            </div>

            {/* Start Appraisal Panel */}
            <div className="space-y-6">
              {/* Selection Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Session Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedTenant.bank ? (
                    <div className="flex items-start gap-3">
                      <Building2 className="w-5 h-5 text-blue-600 mt-0.5" />
                      <div>
                        <p className="font-medium">{selectedTenant.bank.bank_short_name}</p>
                        <p className="text-sm text-gray-600">{selectedTenant.bank.bank_name}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No bank selected</p>
                  )}

                  {selectedTenant.branch ? (
                    <div className="flex items-start gap-3">
                      <Building2 className="w-5 h-5 text-green-600 mt-0.5" />
                      <div>
                        <p className="font-medium">{selectedTenant.branch.branch_name}</p>
                        <p className="text-sm text-gray-600">
                          {selectedTenant.branch.branch_city}, {selectedTenant.branch.branch_state}
                        </p>
                      </div>
                    </div>
                  ) : selectedTenant.bank ? (
                    <p className="text-gray-500 text-sm">No branch selected</p>
                  ) : null}

                  {selectedTenant.user ? (
                    <div className="flex items-start gap-3">
                      <User className="w-5 h-5 text-purple-600 mt-0.5" />
                      <div>
                        <p className="font-medium">{selectedTenant.user.full_name}</p>
                        <p className="text-sm text-gray-600">
                          {selectedTenant.user.role.replace('_', ' ').toUpperCase()}
                        </p>
                        <p className="text-sm text-gray-600">ID: {selectedTenant.user.user_id}</p>
                      </div>
                    </div>
                  ) : selectedTenant.bank ? (
                    <p className="text-gray-500 text-sm">No appraiser selected</p>
                  ) : null}
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <div className="space-y-3">
                <Button
                  onClick={handleStartAppraisal}
                  disabled={!canStartAppraisal}
                  className="w-full gap-2"
                  size="lg"
                >
                  Start Appraisal Session
                  <ChevronRight className="w-4 h-4" />
                </Button>

                <Button
                  variant="outline"
                  onClick={() => navigate("/dashboard")}
                  className="w-full"
                >
                  Back to Dashboard
                </Button>
              </div>

              {/* Requirements */}
              {!canStartAppraisal && (
                <Card className="bg-yellow-50 border-yellow-200">
                  <CardContent className="p-4">
                    <h4 className="font-medium text-yellow-800 mb-2">Requirements</h4>
                    <ul className="text-sm text-yellow-700 space-y-1">
                      {!selectedTenant.bank && (
                        <li>• Select a bank</li>
                      )}
                      {!selectedTenant.user && (
                        <li>• Select an appraiser</li>
                      )}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuroraLayout>
  );
};

export default NewAppraisal;
