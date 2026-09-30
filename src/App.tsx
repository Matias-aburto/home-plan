import { Navigate, Route, Routes } from "react-router";
import { useSession } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { IosInstallGuide } from "./components/IosInstallGuide";
import { Loading } from "./components/Loading";
import { ConnectionProvider } from "./data/ConnectionProvider";
import { MeProvider } from "./data/MeProvider";
import { FamilyPage } from "./family/FamilyPage";
import { JoinFamilyPage } from "./family/JoinFamilyPage";
import { LegacyFamilyProvider, useLegacyFamily } from "./family/LegacyFamilyProvider";
import { useInstallApp } from "./hooks/useInstallApp";
import { ListRoute } from "./lists/ListPage";
import { PersonalHome } from "./lists/PersonalHome";
import { AppShell } from "./shell/AppShell";
import { HomeRedirect } from "./shell/HomeRedirect";
import type { User } from "./types";

export default function App() {
  const installApp = useInstallApp();
  const session = useSession();

  let screen;
  if (session.status === "loading") screen = <Loading />;
  else if (!session.user) {
    screen = <LoginPage canInstall={installApp.canInstall} onInstall={installApp.install} onSignedIn={session.signIn} />;
  } else {
    // La key reinicia todo el estado si entra otra cuenta.
    screen = (
      <MeProvider key={session.user.id} user={session.user}>
        <LegacyFamilyProvider>
          <SignedInApp user={session.user} installApp={installApp} onLogout={session.logout} />
        </LegacyFamilyProvider>
      </MeProvider>
    );
  }

  return (
    <>
      {screen}
      {installApp.showGuide && <IosInstallGuide onClose={installApp.closeGuide} />}
    </>
  );
}

function SignedInApp({
  user,
  installApp,
  onLogout
}: {
  user: User;
  installApp: ReturnType<typeof useInstallApp>;
  onLogout: (everywhere?: boolean) => Promise<void>;
}) {
  const { familyId } = useLegacyFamily();
  const install = { canInstall: installApp.canInstall, onInstall: installApp.install };

  return (
    <ConnectionProvider user={user} familyId={familyId}>
      <Routes>
        <Route path="familia/unirse" element={<JoinFamilyPage user={user} {...install} onLogout={onLogout} />} />
        <Route element={<AppShell user={user} {...install} onLogout={onLogout} />}>
          <Route index element={<HomeRedirect />} />
          <Route path="personal" element={<PersonalHome />} />
          <Route path="listas/:listId" element={<ListRoute />} />
          <Route path="familia/*" element={<FamilyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConnectionProvider>
  );
}
