import { useState } from "react";
import {
  MoreHorizontal,
  ShieldPlus,
  Eye,
  MailPlus,
  Trash2,
  GraduationCap,
  UserMinus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface UserRow {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  discord_username?: string | null;
  created_at: string;
  isAdmin: boolean;
  isTeacher: boolean;
  pendingPromotion: boolean;
  pendingTeacher: boolean;
  isTestAccount?: boolean;
}

interface UserActionsDropdownProps {
  user: UserRow;
  isSelf: boolean;
  onPromote: (user: UserRow) => void;
  onResendInvite: (user: UserRow) => void;
  onView: (user: UserRow) => void;
  onDelete: (user: UserRow) => void;
  onPromoteTeacher: (user: UserRow) => void;
  onRevokeTeacher: (user: UserRow) => void;
}

export function UserActionsDropdown({
  user,
  isSelf,
  onPromote,
  onResendInvite,
  onView,
  onDelete,
  onPromoteTeacher,
  onRevokeTeacher,
}: UserActionsDropdownProps) {
  const [open, setOpen] = useState(false);

  if (isSelf) {
    return <span className="text-muted-foreground text-xs">You</span>;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label={`Actions for ${user.email}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onView(user);
          }}
        >
          <Eye className="h-4 w-4 mr-2" />
          View
        </DropdownMenuItem>

        {!user.isAdmin && !user.pendingPromotion && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onPromote(user);
            }}
          >
            <ShieldPlus className="h-4 w-4 mr-2" />
            Promote to Admin
          </DropdownMenuItem>
        )}

        {user.pendingPromotion && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onResendInvite(user);
            }}
          >
            <MailPlus className="h-4 w-4 mr-2" />
            Resend Admin Invite
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {!user.isTeacher && !user.pendingTeacher && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onPromoteTeacher(user);
            }}
          >
            <GraduationCap className="h-4 w-4 mr-2" />
            Promote to Teacher
          </DropdownMenuItem>
        )}

        {user.pendingTeacher && (
          <DropdownMenuItem disabled>
            <GraduationCap className="h-4 w-4 mr-2" />
            Teacher invite pending
          </DropdownMenuItem>
        )}

        {user.isTeacher && (
          <DropdownMenuItem
            onClick={() => {
              setOpen(false);
              onRevokeTeacher(user);
            }}
            className="text-destructive focus:text-destructive"
          >
            <UserMinus className="h-4 w-4 mr-2" />
            Revoke Teacher
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            onDelete(user);
          }}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete User
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
