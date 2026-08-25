"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

// The app ships a single light theme (`colorScheme: 'light'` in the root
// layout), so the toaster must match rather than follow the OS setting.
const Toaster = ({ theme = "light", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // Signed-in phones pin a hub bar at the bottom (`h-14` + safe area).
      // Default sonner inset sits under that bar.
      mobileOffset={{
        bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.75rem)',
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
