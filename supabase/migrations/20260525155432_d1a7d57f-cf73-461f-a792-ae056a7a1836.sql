
REVOKE EXECUTE ON FUNCTION public.submit_class_for_review(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_and_publish_class(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_class_changes(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.archive_class(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_class_email_recipients(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_admin_email_recipients() FROM PUBLIC, anon;
