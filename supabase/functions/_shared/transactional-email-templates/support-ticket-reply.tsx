import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = "Tech Fleet Network"

interface SupportTicketReplyProps {
  firstName?: string
  subject?: string
  preview?: string
  replierName?: string
  ticketUrl?: string
}

const SupportTicketReplyEmail = ({ firstName, subject, preview, replierName, ticketUrl }: SupportTicketReplyProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{replierName || 'The Tech Fleet team'} replied to your support ticket</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={headerSection}>
          <Text style={brandTag}>TECH FLEET NETWORK</Text>
        </Section>

        <Heading style={h1}>You have a new reply on your support ticket</Heading>

        <Text style={text}>Hi {firstName || 'there'},</Text>

        <Text style={text}>
          {replierName || 'The Tech Fleet team'} replied to your support ticket
          {subject ? <> about <strong>{subject}</strong></> : null}.
        </Text>

        {preview ? (
          <Section style={previewBox}>
            <Text style={previewLabel}>REPLY PREVIEW</Text>
            <Text style={previewText}>{preview}</Text>
          </Section>
        ) : null}

        <Section style={ctaSection}>
          <Button style={ctaButton} href={ticketUrl || 'https://techfleet.network/community/get-help'}>
            Open your ticket
          </Button>
        </Section>

        <Hr style={hr} />
        <Text style={signature}>{SITE_NAME} Support</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: SupportTicketReplyEmail,
  subject: (data: Record<string, any>) => data?.subject ? `Re: ${data.subject}` : 'New reply on your support ticket',
  displayName: 'Support ticket reply',
  previewData: {
    firstName: 'Jane',
    subject: 'Cannot upload my avatar',
    preview: 'Thanks for the report — we just shipped a fix. Please try again and let us know if it works for you.',
    replierName: 'Alex from Tech Fleet',
    ticketUrl: 'https://techfleet.network/community/get-help?ticket=123',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '580px', margin: '0 auto' }
const headerSection = { textAlign: 'center' as const, marginBottom: '24px' }
const brandTag = { fontSize: '13px', fontWeight: '700' as const, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.05em', margin: '0' }
const h1 = { fontSize: '22px', fontWeight: '700' as const, color: '#18181b', margin: '0 0 20px', textAlign: 'center' as const }
const text = { fontSize: '15px', color: '#3f3f46', lineHeight: '1.7', margin: '0 0 16px' }
const previewBox = { backgroundColor: '#f8fafc', borderLeft: '3px solid #0056A7', borderRadius: '4px', padding: '16px 18px', margin: '20px 0' }
const previewLabel = { fontSize: '11px', fontWeight: '700' as const, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.08em', margin: '0 0 8px' }
const previewText = { fontSize: '14px', color: '#3f3f46', lineHeight: '1.6', margin: '0', whiteSpace: 'pre-wrap' as const }
const ctaSection = { textAlign: 'center' as const, margin: '24px 0' }
const ctaButton = { backgroundColor: '#0056A7', borderRadius: '6px', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, textDecoration: 'none', padding: '12px 24px', display: 'inline-block' }
const hr = { borderColor: '#e5e7eb', margin: '28px 0 16px' }
const signature = { fontSize: '13px', color: '#6b7280', margin: '0', textAlign: 'center' as const }
