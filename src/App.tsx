import { Navigate, Route, Routes } from "react-router";
import { useSession } from "./auth/AuthProvider";
import { LoginPage } from "./auth/LoginPage";
import { IosInstallGuide } from "./components/IosInstallGuide";
import { Loading } from "./components/Loading";
import { ConnectionProvider } from "./data/ConnectionProvider";
import { MeProvider, useMe } from "./data/MeProvider";
import { FamilyCalendarRoute } from "./family/FamilyCalendarPage";
import { FamilyHomePage } from "./family/FamilyHomePage";
import { FamilySettingsRoute } from "./family/FamilySettingsPage";
import { NewFamilyPage } from "./family/NewFamilyPage";
import { useInstallApp } from "./hooks/useInstallApp";
import { InvitationLanding } from "./invitations/InvitationLanding";
import { InvitationsPage } from "./invitations/InvitationsPage";
import { ListRoute } from "./lists/ListPage";
import { PersonalHome } from "./lists/PersonalHome";
import { SharedHome } from "./lists/SharedHome";
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
        <SignedInApp user={session.user} installApp={installApp} onLogout={session.logout} />
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
  const { families } = useMe();
  const install = { canInstall: installApp.canInstall, onInstall: installApp.install };

  return (
    <ConnectionProvider user={user} familyIds={families.map(({ id }) => id)}>
      <Routes>
        <Route path="familias/nueva" element={<NewFamilyPage user={user} {...install} onLogout={onLogout} />} />
        <Route path="invitacion/:token" element={<InvitationLanding user={user} onLogout={onLogout} />} />
        <Route element={<AppShell user={user} {...install} onLogout={onLogout} />}>
          <Route index element={<HomeRedirect />} />
          <Route path="personal" element={<PersonalHome />} />
          <Route path="compartidas" element={<SharedHome />} />
          <Route path="invitaciones" element={<InvitationsPage />} />
          <Route path="listas/:listId" element={<ListRoute />} />
          <Route path="familias/:familyId" element={<FamilyHomePage />} />
          <Route path="familias/:familyId/calendario" element={<FamilyCalendarRoute />} />
          <Route path="familias/:familyId/ajustes" element={<FamilySettingsRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConnectionProvider>
  );
}
