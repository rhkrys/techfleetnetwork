/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You asked for a sign-in link to Tech Fleet. Confirm to log in.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Sign in to Tech Fleet</Heading>
        <Text style={text}>You asked for a sign-in link. Click below to log in. The link expires in 1 hour.</Text>
        <Button style={button} href={confirmationUrl}>Sign in</Button>
        <Text style={footer}>You're getting this because someone asked for a sign-in link to your Tech Fleet account. If that wasn't you, ignore this email. Reply directly to reach a person.</Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#141726', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0 0 25px' }
const button = { backgroundColor: '#0056A7', color: '#ffffff', fontSize: '14px', borderRadius: '6px', padding: '12px 24px', textDecoration: 'none', fontWeight: '600' as const }
const footer = { fontSize: '12px', color: '#64748b', margin: '30px 0 0' }
