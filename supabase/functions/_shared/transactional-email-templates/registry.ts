/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as interviewInvite } from './interview-invite.tsx'
import { template as questNudge } from './quest-nudge.tsx'
import { template as applicantStatusChange } from './applicant-status-change.tsx'
import { template as signupConfirmationReminder } from './signup-confirmation-reminder.tsx'
import { template as fleetyCoachDigest } from './fleety-coach-digest.tsx'
import { template as triageDigest } from './triage-digest.tsx'
import { template as observerRoleGranted } from './observer-role-granted.tsx'
import { template as projectBlast } from './project-blast.tsx'
import { template as communityAgreementRequest } from './community-agreement-request.tsx'
import { template as adminMemberAlert } from './admin-member-alert.tsx'
import { template as classStatusChange } from './class-status-change.tsx'
import { template as supportTicketReply } from './support-ticket-reply.tsx'
import { template as resumeApplication } from './resume-application.tsx'
import { template as generalApplicationSubmitted } from './general-application-submitted.tsx'
import { template as projectApplicationSubmitted } from './project-application-submitted.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'interview-invite': interviewInvite,
  'quest-nudge': questNudge,
  'applicant-status-change': applicantStatusChange,
  'signup-confirmation-reminder': signupConfirmationReminder,
  'fleety-coach-digest': fleetyCoachDigest,
  'triage-digest': triageDigest,
  'observer-role-granted': observerRoleGranted,
  'project-blast': projectBlast,
  'community-agreement-request': communityAgreementRequest,
  'admin-member-alert': adminMemberAlert,
  'class-status-change': classStatusChange,
  'support-ticket-reply': supportTicketReply,
  'resume-application': resumeApplication,
  'general-application-submitted': generalApplicationSubmitted,
  'project-application-submitted': projectApplicationSubmitted,
}
