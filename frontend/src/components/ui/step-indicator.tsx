"use client";
import { Camera, User, Shield, FlaskConical, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface StepIndicatorProps {
  currentStep: number;
  showIndividualStep?: boolean; // when false, show 5-step variant without Individual image
}

export function StepIndicator({ currentStep, showIndividualStep = true }: StepIndicatorProps) {
  const navigate = useNavigate();
  const steps = showIndividualStep
    ? [
        { key: 1, label: "Customer image", icon: Camera, route: "/camera-test?stage=customer", enabled: true },
        { key: 2, label: "RBI", icon: Shield, route: "/rbi-compliance", enabled: true },
        { key: 3, label: "Individual image", icon: Camera, route: "/camera-test?stage=individual", enabled: true },
        { key: 4, label: "Purity", icon: FlaskConical, route: "/purity-testing", enabled: true },
        { key: 5, label: "Summary", icon: FileText, route: "/appraisal-summary", enabled: true },
      ]
    : [
        { key: 1, label: "Customer image", icon: Camera, route: "/camera-test?stage=customer", enabled: true },
        { key: 2, label: "RBI", icon: Shield, route: "/rbi-compliance", enabled: true },
        { key: 3, label: "Purity", icon: FlaskConical, route: "/purity-testing", enabled: true },
        { key: 4, label: "Summary", icon: FileText, route: "/appraisal-summary", enabled: true },
      ];

  return (
    <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm rounded-lg p-2 shadow-md border">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <>
            <div key={step.key} className="flex flex-col items-center flex-1">
              <button
                type="button"
                onClick={() => step.enabled && navigate(step.route)}
                disabled={!step.enabled}
                className={
                  "w-8 h-8 rounded-full flex items-center justify-center mb-1 transition " +
                  (currentStep === step.key
                    ? "bg-gradient-to-r from-yellow-500 to-amber-600 text-white shadow-md"
                    : "bg-neutral-200 dark:bg-neutral-700 text-neutral-400 dark:text-neutral-500 hover:bg-neutral-300/90 dark:hover:bg-neutral-600/90")
                }
              >
                <step.icon className="w-4 h-4" />
              </button>
              <p className={
                "text-[10px] font-medium " +
                (currentStep === step.key
                  ? "text-yellow-700 dark:text-yellow-400"
                  : "text-neutral-500 dark:text-neutral-400")
              }>
                {step.label}
              </p>
            </div>
            {index < steps.length - 1 && (
              <div className="flex-1 h-0.5 bg-neutral-200 dark:bg-neutral-700 mx-1" />
            )}
          </>
        ))}
      </div>
    </div>
  );
}

export default StepIndicator;


