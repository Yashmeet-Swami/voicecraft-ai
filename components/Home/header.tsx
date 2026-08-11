"use client";

import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3 } from "lucide-react";
import NotificationBell from "@/components/notifications/notification-bell";

const NavLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => {
  return (
    <Link
      href={href}
      className="transition-colors duration-200 text-gray-600 hover:text-purple-500"
    >
      {children}
    </Link>
  );
};

export default function Header() {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

  if (isAuthPage) {
    return (
      // THE FIX: Changed p-8 to px-8 py-4 to match the main header's padding
      <nav className="absolute left-0 top-0 z-20 w-full px-8 py-4">
        <NavLink href="/">
          <span className="flex items-center gap-2">
            <Image
              src="/icon.ico"
              alt="VoiceCraft logo"
              width={32}
              height={32}
              className="hover:rotate-12 transform transition duration-200 ease-in-out"
            />
            <span className="font-extrabold text-lg text-white">VoiceCraft</span>
          </span>
        </NavLink>
      </nav>
    );
  }

  // --- On all other pages, render the full header ---
  return (
    <nav className="sticky top-0 z-30 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
      <div className="container mx-auto flex items-center justify-between px-8 py-4">
        <div className="flex lg:flex-1">
          <NavLink href="/">
            <span className="flex shrink-0 items-center gap-2">
              <Image
                src="/icon.ico"
                alt="VoiceCraft logo"
                width={32}
                height={32}
                className="transform transition duration-200 ease-in-out hover:rotate-12"
              />
              <span className="text-lg font-extrabold">VoiceCraft</span>
            </span>
          </NavLink>
        </div>

        <div className="flex items-center gap-8 lg:justify-center">
          <SignedIn>
            <NavLink href="/meetings">Meetings</NavLink>
            <NavLink href="/action-items">Action Items</NavLink>
            <NavLink href="/posts">Blog Posts</NavLink>
          </SignedIn>
        </div>

        <div className="flex lg:flex-1 lg:justify-end">
          <SignedIn>
            <div className="flex items-center gap-3">
              <NavLink href="/dashboard">New Blog Post</NavLink>
              <NotificationBell />
              <UserButton>
                <UserButton.MenuItems>
                  <UserButton.Link
                    label="Usage"
                    labelIcon={<BarChart3 className="w-4 h-4" />}
                    href="/usage"
                  />
                </UserButton.MenuItems>
              </UserButton>
            </div>
          </SignedIn>
          <SignedOut>
            <SignInButton>
              <NavLink href="/sign-in">Sign In</NavLink>
            </SignInButton>
          </SignedOut>
        </div>
      </div>
    </nav>
  );
}