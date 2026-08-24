/**
 * Notifications Page
 *
 * Dedicated page at /profile/notifications showing all notifications
 * in an AG Grid table with mark-read actions and mark-all-read button.
 * Breadcrumb: Profile > Notifications
 */

import { useEffect, useMemo, useCallback } from "react";
import { format } from "date-fns";
import { CheckCheck, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/design-system";

import { ThemedAgGrid } from "@/components/AgGrid";
import { usePageHeader } from "@/contexts/PageHeaderContext";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useUnreadNotificationCount,
} from "@/hooks/use-notifications";
import { stripHtml } from "@/lib/html";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import type { AppNotification } from "@/services/notification.service";
import {
  collapseNotificationsToDigest,
  isStack,
  type DigestRow,
} from "@/lib/notifications/collapseDigest";

/** Friendly label for notification_type values */
function typeLabel(type: string): string {
  const map: Record<string, string> = {
    project_opening: "Project Opening",
    feedback: "Feedback",
    error_alert: "Error Alert",
    general: "General",
    announcement: "Announcement",
  };
  return map[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NotificationsPage() {
  const { setHeader } = usePageHeader();
  const navigate = useNavigate();
  const { data: notifications = [], isLoading } = useNotifications(500);
  const digestRows = useMemo<DigestRow[]>(
    () => collapseNotificationsToDigest(notifications),
    [notifications]
  );
  const unreadCount = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  useEffect(() => {
    setHeader({
      title: "Notifications",
      breadcrumbs: [{ label: "Profile", href: "/profile/edit" }, { label: "Notifications" }],
    });
    return () => setHeader(null);
  }, [setHeader]);

  const handleMarkAllRead = useCallback(() => {
    markAllRead.mutate();
  }, [markAllRead]);

  const columnDefs = useMemo<ColDef<DigestRow>[]>(
    () => [
      {
        headerName: "Status",
        field: "read",
        width: 100,
        cellRenderer: (params: ICellRendererParams<AppNotification>) => {
          if (!params.data) return null;
          return params.data.read ? (
            <span className="text-xs text-muted-foreground">Read</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Unread
            </span>
          );
        },
        filter: true,
      },
      {
        headerName: "Type",
        field: "notification_type",
        width: 150,
        valueFormatter: (params) => typeLabel(params.value || ""),
        filter: true,
      },
      {
        headerName: "Title",
        field: "title",
        flex: 1,
        minWidth: 200,
        filter: true,
      },
      {
        headerName: "Message",
        field: "body_html",
        flex: 2,
        minWidth: 250,
        valueFormatter: (params) => stripHtml(params.value || "").slice(0, 200),
        filter: true,
      },
      {
        headerName: "Date",
        field: "created_at",
        width: 170,
        valueFormatter: (params) =>
          params.value ? format(new Date(params.value), "MMM d, yyyy h:mm a") : "",
        sort: "desc",
        filter: "agDateColumnFilter",
      },
      {
        headerName: "Actions",
        width: 180,
        pinned: "right",
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<DigestRow>) => {
          if (!params.data) return null;
          const row = params.data;
          if (isStack(row)) {
            return (
              <div className="flex items-center gap-1 h-full">
                <span className="text-xs text-muted-foreground">{row.stackCount} grouped</span>
              </div>
            );
          }
          const notif = row;
          return (
            <div className="flex items-center gap-1 h-full">
              {!notif.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    markRead.mutate(notif.id);
                  }}
                >
                  <CheckCheck className="h-3 w-3" />
                  Mark Read
                </Button>
              )}
              {notif.link_url && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(notif.link_url);
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                  View
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [markRead, navigate]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {unreadCount > 0
            ? `You have ${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
            : "All caught up! 🎉"}
        </p>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleMarkAllRead}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark All Read
          </Button>
        )}
      </div>

      <ThemedAgGrid
        gridId="notifications"
        rowData={digestRows}
        columnDefs={columnDefs}
        loading={isLoading}
        domLayout="autoHeight"
        pagination={true}
        paginationPageSize={25}
        getRowId={(params) => params.data.id}
      />
    </div>
  );
}
