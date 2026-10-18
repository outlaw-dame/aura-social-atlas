import { Link } from '@tanstack/react-router';
import { CircleUserRound, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAtlasAuth } from './AuthState';
import { avatarPreset, defaultAvatarKey } from '@/lib/atlas-avatars';

export function AccountButton() {
  const { user, profile, loading, signOut } = useAtlasAuth();

  if (loading) {
    return <div className="size-8 shrink-0 rounded-full bg-[var(--color-surface-glass)]" aria-hidden />;
  }

  if (!user) {
    return (
      <Button
        asChild
        size="sm"
        variant="ghost"
        className="social-avatar h-8 shrink-0 rounded-full"
        aria-label="Sign in or create an account"
      >
        <Link to="/auth">
          <CircleUserRound className="size-4" aria-hidden />
          <span className="sr-only">Sign in or create an account</span>
        </Link>
      </Button>
    );
  }

  const preset = avatarPreset(profile?.avatar_key ?? defaultAvatarKey(user.id));
  const name = profile?.display_name || user.email || 'Your account';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="social-avatar h-8 w-8 shrink-0 rounded-full p-0"
          aria-label={`Account menu for ${name}`}
        >
          <img
            src={preset.src}
            alt=""
            className="size-8 rounded-full object-cover"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="social-glass w-56">
        <DropdownMenuLabel className="normal-case">
          <div className="flex items-center gap-2">
            <img src={preset.src} alt="" className="size-9 rounded-full object-cover" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{name}</div>
              {user.email && <div className="truncate text-xs opacity-70">{user.email}</div>}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
