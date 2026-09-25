import React from 'react';
import { Bot, Shield, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { UserProfile } from '@/types';

interface NavbarProps {
  user: UserProfile;
}

export const Navbar: React.FC<NavbarProps> = ({ user }) => {
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md z-20">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
          <Bot size={18} className="text-white" />
        </div>
        <span className="font-bold text-base bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
          BYoAI Agent Platform
        </span>
        <Badge variant="default" className="text-[10px] tracking-wider uppercase">
          Chat UI
        </Badge>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500 animate-pulse" />
          <span>Connected</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-200">
          {user.isAuthenticated ? (
            <>
              <User size={14} className="text-indigo-400" />
              <span>{user.name || user.email || 'Authenticated User'}</span>
            </>
          ) : (
            <a href="/auth/login" className="flex items-center gap-1.5 hover:text-white transition-colors">
              <Shield size={14} className="text-indigo-400" />
              <span>Sign In with OAuth</span>
            </a>
          )}
        </div>
      </div>
    </header>
  );
};
