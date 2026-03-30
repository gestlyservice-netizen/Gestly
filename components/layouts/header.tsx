"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import { Menu, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const { user } = useUser();

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
      {/* Left: mobile menu + greeting */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden text-slate-600"
          onClick={onMenuToggle}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="hidden sm:block">
          <p className="text-sm text-slate-500">Bonjour,</p>
          <p className="text-sm font-semibold text-slate-900 leading-none">
            {user?.firstName ?? user?.emailAddresses[0]?.emailAddress ?? "Utilisateur"}
          </p>
        </div>
      </div>

      {/* Right: notifications + user */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative text-slate-600">
          <Bell className="h-5 w-5" />
        </Button>
        <div className="h-6 w-px bg-slate-200" />
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
      </div>
    </header>
  );
}
