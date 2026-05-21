/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join Tech Fleet. Accept to create your account.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You've been invited to Tech Fleet</Heading>
        <Text style={text}>
          A teammate invited you to join Tech Fleet at{' '}
          <Link href={siteUrl} style={link}>techfleet.network</Link>. Accept below to set up your account.
        </Text>
        <Button style={button} href={confirmationUrl}>Accept invitation</Button>
        <Text style={footer}>You're getting this because someone invited your email to Tech Fleet. If you weren't expecting it, ignore this email. Reply directly to reach a person.</Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#141726', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 25px' }
const link = { color: '#0056A7', textDecoration: 'underline' }
const button = { backgroundColor: '#0056A7', color: '#ffffff', fontSize: '14px', borderRadius: '6px', padding: '12px 24px', textDecoration: 'none', fontWeight: '600' as const }
const footer = { fontSize: '12px', color: '#64748b', margin: '30px 0 0' }
