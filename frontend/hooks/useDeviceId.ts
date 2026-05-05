"use client";

import { useState, useEffect } from "react";

export function useDeviceId(): { deviceId: string | null } {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    async function initDeviceId() {
      // Return stored ID immediately if it exists
      const stored = localStorage.getItem("sf_device_id");
      if (stored) {
        setDeviceId(stored);
        return;
      }

      // Build browser fingerprint
      const fingerprint = [
        screen.width,
        screen.height,
        screen.colorDepth,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.language,
        navigator.hardwareConcurrency,
        navigator.platform,
      ].join("|");

      // SHA-256 hash → hex string
      const encoded = new TextEncoder().encode(fingerprint);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", encoded);
      const hex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      localStorage.setItem("sf_device_id", hex);
      setDeviceId(hex);
    }

    initDeviceId().catch(() => {
      // Fallback: random UUID if crypto.subtle is unavailable
      const fallback = crypto.randomUUID();
      localStorage.setItem("sf_device_id", fallback);
      setDeviceId(fallback);
    });
  }, []); // runs once on mount

  return { deviceId };
}
