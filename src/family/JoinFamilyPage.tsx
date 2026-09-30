import { useState } from "react";
import { useNavigate } from "react-router";
import { Onboarding } from "../onboarding/Onboarding";
import type { User, View } from "../types";
import { useLegacyFamily } from "./LegacyFamilyProvider";

// Crear una familia o entrar a una con su código.
export function JoinFamilyPage({
  user,
  canInstall,
  onInstall,
  onLogout
}: {
  user: User;
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onLogout: (everywhere?: boolean) => Promise<void>;
}) {
  const legacy = useLegacyFamily();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("welcome");
  const [error, setError] = useState(legacy.error);

  return (
    <Onboarding
      view={view}
      error={error}
      user={user}
      canInstall={canInstall}
      onInstall={onInstall}
      onViewChange={(nextView) => {
        setError("");
        setView(nextView);
      }}
      onError={setError}
      onEnter={(family) => {
        legacy.enter(family);
        navigate("/familia", { replace: true });
      }}
      onBack={() => navigate("/")}
      onLogout={onLogout}
    />
  );
}
