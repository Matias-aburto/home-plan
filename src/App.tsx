import { Navigate, Route, Routes, useLocation, useParams } from "react-router";
import { useSession } from "./auth/AuthProvider";
import { AgendaPage } from "./calendar/AgendaPage";
import { CalendarRoute } from "./calendar/CalendarPage";
import { LoginPage } from "./auth/LoginPage";
import { IosInstallGuide } from "./components/IosInstallGuide";
import { Loading } from "./components/Loading";
import { ConnectionProvider } from "./data/ConnectionProvider";
import { MeProvider, useMe } from "./data/MeProvider";
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
        <Route path="grupos/nuevo" element={<NewFamilyPage user={user} {...install} onLogout={onLogout} />} />
        <Route path="invitacion/:token" element={<InvitationLanding user={user} onLogout={onLogout} />} />
        <Route element={<AppShell user={user} {...install} onLogout={onLogout} />}>
          <Route index element={<HomeRedirect />} />
          <Route path="personal" element={<PersonalHome />} />
          <Route path="compartidas" element={<SharedHome />} />
          <Route path="invitaciones" element={<InvitationsPage />} />
          <Route path="listas/:listId" element={<ListRoute />} />
          <Route path="grupos/:familyId" element={<FamilyHomePage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="calendarios/:calendarId" element={<CalendarRoute />} />
          <Route path="grupos/:familyId/calendario" element={<GroupCalendarRedirect />} />
          <Route path="grupos/:familyId/ajustes" element={<FamilySettingsRoute />} />
          <Route path="familias/*" element={<FamiliesRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ConnectionProvider>
  );
}

// El calendario único de cada grupo pasó a ser un calendario más del grupo.
function GroupCalendarRedirect() {
  const { familyId = "" } = useParams();
  const { calendars } = useMe();
  const calendar = calendars.find((candidate) => candidate.familyId === familyId.toUpperCase());
  return <Navigate to={calendar ? `/calendarios/${calendar.id}` : `/grupos/${familyId}`} replace />;
}

// Los enlaces de antes del cambio a grupos (/familias/...) siguen funcionando.
function FamiliesRedirect() {
  const { pathname, search } = useLocation();
  const target = pathname.replace(/^\/familias\/nueva/, "/grupos/nuevo").replace(/^\/familias/, "/grupos");
  return <Navigate to={{ pathname: target, search }} replace />;
}
