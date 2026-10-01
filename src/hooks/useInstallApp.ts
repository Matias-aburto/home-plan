import { useEffect, useState } from "react";
import type { BeforeInstallPromptEvent } from "../types";

export function useInstallApp() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // En escritorio (mouse y sin pantalla táctil) no se ofrece: instalar ahí aporta poco y el navegador
  // ya muestra su propio ícono de instalar en la barra de direcciones.
  const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches && !isIos;

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);

    const onBeforeInstall = (event: Event) => {
      if (isDesktop) return;
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      setShowGuide(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [isDesktop]);

  async function install() {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setPrompt(null);
      return;
    }
    if (isIos) setShowGuide(true);
  }

  return {
    canInstall: !isDesktop && !installed && (Boolean(prompt) || isIos),
    install,
    showGuide,
    closeGuide: () => setShowGuide(false)
  };
}
