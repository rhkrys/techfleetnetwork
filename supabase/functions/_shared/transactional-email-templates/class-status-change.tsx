import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Section, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Tech Fleet Network'
const BASE_URL = 'https://techfleet.network'

type Action = 'submitted' | 'approved' | 'changes_requested' | 'archived'
type RecipientRole = 'teacher' | 'admin'

interface ClassStatusChangeProps {
  action: Action
  recipientName?: string
  recipientRole: RecipientRole
  classTitle: string
  actorName?: string
  reason?: string
  linkPath: string
}

const HEADLINES: Record<Action, Record<RecipientRole, string>> = {
  submitted: {
    teacher: 'Your class is being reviewed',
    admin: 'A new class is ready for review',
  },
  approved: {
    teacher: 'Your class was approved',
    admin: 'A class was approved',
  },
  changes_requested: {
    teacher: 'Changes requested on your class',
    admin: 'Changes were requested on a class',
  },
  archived: {
    teacher: 'Your class was archived',
    admin: 'A class was archived',
  },
}

const BODY_INTRO: Record<Action, Record<RecipientRole, (title: string, actor?: string) => string>> = {
  submitted: {
    teacher: (t) => `Thanks for submitting "${t}". An admin will review it soon and let you know what's next.`,
    admin: (t) => `A teacher submitted "${t}" for review. Take a look when you have a moment.`,
  },
  approved: {
    teacher: (t) => `Great news — "${t}" was approved and is now published.`,
    admin: (t, a) => `${a || 'An admin'} approved "${t}" and published it.`,
  },
  changes_requested: {
    teacher: (t) => `An admin asked for some changes on "${t}". The notes are below.`,
    admin: (t, a) => `${a || 'An admin'} requested changes on "${t}".`,
  },
  archived: {
    teacher: (t) => `"${t}" has been archived. You can restore it from your classes page if needed.`,
    admin: (t, a) => `${a || 'An admin'} archived "${t}".`,
  },
}

const CTA_LABEL: Record<Action, Record<RecipientRole, string>> = {
  submitted: { teacher: 'View your class', admin: 'Review the class' },
  approved: { teacher: 'View your class', admin: 'View the class' },
  changes_requested: { teacher: 'Open the class', admin: 'View the class' },
  archived: { teacher: 'Open the class', admin: 'View the class' },
}

const ClassStatusChangeEmail = ({
  action,
  recipientName,
  recipientRole,
  classTitle,
  actorName,
  reason,
  linkPath,
}: ClassStatusChangeProps) => {
  const headline = HEADLINES[action][recipientRole]
  const intro = BODY_INTRO[action][recipientRole](classTitle, actorName)
  const ctaLabel = CTA_LABEL[action][recipientRole]
  const fullLink = `${BASE_URL}${linkPath}`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{headline}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={headerSection}>
            <Text style={brandTag}>TECH FLEET NETWORK</Text>
          </Section>

          <Heading style={h1}>{headline}</Heading>

          <Text style={text}>Hi {recipientName || 'there'},</Text>
          <Text style={text}>{intro}</Text>

          {action === 'changes_requested' && reason ? (
            <Section style={reasonBox}>
              <Text style={reasonLabel}>WHAT TO ADJUST</Text>
              <Text style={reasonBody}>{reason}</Text>
            </Section>
          ) : null}

          <Section style={ctaSection}>
            <Button href={fullLink} style={ctaButton}>{ctaLabel}</Button>
          </Section>

          <Hr style={hr} />
          <Text style={footer}>You're receiving this because you're part of {SITE_NAME}.</Text>
        </Container>
      </Body>
    </Html>
  )
}

const subject = ({ action, recipientRole, classTitle }: ClassStatusChangeProps) => {
  const head = HEADLINES[action][recipientRole]
  return `${head}: ${classTitle}`
}

export const template = {
  component: ClassStatusChangeEmail,
  subject,
  displayName: 'Class status change',
  previewData: {
    action: 'submitted',
    recipientName: 'Alex',
    recipientRole: 'admin',
    classTitle: 'Service Leadership Masterclass',
    actorName: 'Jordan',
    linkPath: '/admin/classes',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Poppins, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const headerSection = { paddingBottom: '12px' }
const brandTag = { fontSize: '11px', letterSpacing: '0.12em', color: '#0056A7', fontWeight: 700, margin: 0 }
const h1 = { fontSize: '22px', fontWeight: 700, color: '#01061E', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#1f2937', lineHeight: '1.55', margin: '0 0 14px' }
const reasonBox = { backgroundColor: '#f5f7fb', borderRadius: '10px', padding: '14px 16px', margin: '16px 0' }
const reasonLabel = { fontSize: '11px', letterSpacing: '0.1em', color: '#0056A7', fontWeight: 700, margin: '0 0 6px' }
const reasonBody = { fontSize: '14px', color: '#1f2937', lineHeight: '1.55', margin: 0, whiteSpace: 'pre-wrap' as const }
const ctaSection = { margin: '20px 0 8px' }
const ctaButton = { backgroundColor: '#0056A7', color: '#ffffff', padding: '10px 18px', borderRadius: '8px', textDecoration: 'none', fontWeight: 600, fontSize: '14px' }
const hr = { borderColor: '#e5e7eb', margin: '24px 0 12px' }
const footer = { fontSize: '12px', color: '#6b7280', margin: 0 }
