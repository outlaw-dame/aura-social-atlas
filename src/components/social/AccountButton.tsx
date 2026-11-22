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
import { IdentityAvatar } from './IdentityAvatar';
import { useFedizenIdentity } from './useFedizenIdentity';

export function AccountButton() {
  const { user, loading, signOut } = useAtlasAuth();
  const identity = useFedizenIdentity();

  if (loading) {
    return <div className="size-8 shrink-0 atlas-avatar bg-muted" aria-hidden />;
  }

  if (!user) {
    return (
      <Button
        asChild
        size="sm"
        variant="ghost"
        className="social-avatar h-8 shrink-0"
        aria-label="Sign in or create an account"
      >
        <Link to="/auth">
          <CircleUserRound className="size-4" aria-hidden />
          <span className="sr-only">Sign in or create an account</span>
        </Link>
      </Button>
    );
  }

  const name = identity.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="social-avatar h-8 w-8 shrink-0 p-0"
          aria-label={`Account menu for ${name}`}
        >
          <IdentityAvatar src={identity.avatar} name={name} className="size-8 atlas-avatar object-cover" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="normal-case">
          <div className="flex items-center gap-2">
            <IdentityAvatar src={identity.avatar} name={name} className="size-9 atlas-avatar object-cover" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="truncate text-xs opacity-70">{identity.handle}</div>
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
