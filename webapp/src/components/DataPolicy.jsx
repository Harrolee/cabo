import React from 'react';
import { LEGAL_CONTACT_EMAIL, LEGAL_LAST_UPDATED } from './TermsOfService';

/**
 * The Privacy Policy. Rendered both at /privacy (the URL the iOS app links to,
 * and the one submitted to App Review) and inside the signup modal.
 *
 * Section 4 describes the reference photo and likeness consent the visualiser
 * uses — the photo is only ever used when `likeness_consent` is set, and
 * withdrawing consent deletes it.
 */
export function DataPolicy() {
  return (
    <div className="p-8 max-w-3xl mx-auto text-gray-800">
      <h1 className="text-2xl font-bold mb-1">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-6">Last updated {LEGAL_LAST_UPDATED}</p>

      <p>
        This policy explains what Cabo Coaches (the <em>Coaches</em> iOS app and this website),
        operated by Lee Harrold, collects about you, why, who else sees it, and how to get it
        deleted.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">1. What we collect</h2>
      <ul className="list-disc pl-6 mt-2 space-y-2">
        <li>
          <strong>Account.</strong> Your email address, or the identifier Apple gives us when you
          use Sign in with Apple (which may be a private relay address). On the legacy SMS
          service, your name and mobile number.
        </li>
        <li>
          <strong>Your conversations.</strong> The messages you send to a coach and the replies it
          sends you, kept so a thread reads as a continuous relationship.
        </li>
        <li>
          <strong>Goals and preferences.</strong> What you tell a coach you are working toward,
          and your notification and coach settings.
        </li>
        <li>
          <strong>Subscription status.</strong> Which coaches you subscribe to, and the receipt
          identifiers Apple or Stripe give us. We never see your card number.
        </li>
        <li>
          <strong>Device push token.</strong> An anonymous token for the device, so a coach can
          notify you when the app is closed.
        </li>
        <li>
          <strong>A reference photo</strong>, only if you choose to upload one &mdash; see section
          4.
        </li>
        <li>
          <strong>Your time zone</strong>, so notifications arrive at a reasonable hour where you
          are, and so that any safety resources we show you are ones you can actually reach.
        </li>
        <li>
          <strong>A safety flag</strong>, if something you write suggests you may be in crisis
          &mdash; see section 5.
        </li>
      </ul>
      <p className="mt-3">
        We do not use advertising trackers, and we do not sell or rent your personal information.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">2. Why we use it</h2>
      <p>
        To run your account, to let coaches hold a coherent conversation with you, to generate the
        images you ask for, to send the notifications you have allowed, to bill and to restore
        purchases, and to keep the Service working and secure. We do not use your conversations to
        train AI models.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">3. Who else processes it</h2>
      <ul className="list-disc pl-6 mt-2 space-y-2">
        <li>
          <strong>Supabase</strong> &mdash; database, authentication, and file storage.
        </li>
        <li>
          <strong>Google Cloud</strong> &mdash; the servers and storage buckets that run the
          Service.
        </li>
        <li>
          <strong>OpenAI</strong> &mdash; receives the recent part of a conversation, and the
          coach&rsquo;s persona, in order to generate that coach&rsquo;s reply.
        </li>
        <li>
          <strong>Replicate</strong> &mdash; runs the image models used by the visualiser, and
          receives the prompt and, where section 4 applies, your reference photo.
        </li>
        <li>
          <strong>Expo and Apple</strong> &mdash; relay and deliver push notifications to your
          device.
        </li>
        <li>
          <strong>Apple and Stripe</strong> &mdash; process payments and subscription status.
        </li>
        <li>
          <strong>Twilio</strong> &mdash; sends messages on the legacy SMS service only.
        </li>
      </ul>
      <p className="mt-3">
        Each is a processor acting on our instructions. We share personal information with no one
        else, except where the law requires it.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">4. Your photo and your likeness</h2>
      <p>
        The visualiser generates pictures of the goal you are working toward. By default it uses a
        scene-only model and the images deliberately show no identifiable face.
      </p>
      <p className="mt-3">
        You may optionally upload a reference photo of yourself so that generated images resemble
        you. If you do:
      </p>
      <ul className="list-disc pl-6 mt-2 space-y-2">
        <li>
          <strong>It is used to generate images of you.</strong> The photo is sent to Replicate,
          along with the prompt, and used as the likeness input to an identity-preserving image
          model. The resulting images are your own; they are stored with your visualisation
          history so you can look back at them.
        </li>
        <li>
          <strong>It is stored.</strong> The photo is kept in our storage bucket and linked to
          your profile, so you do not have to re-upload it for each generation. It is served only
          over short-lived signed links.
        </li>
        <li>
          <strong>It is used only with your explicit consent.</strong> Uploading is not enough:
          the identity-preserving model is used only while a separate likeness consent toggle is
          on. With the toggle off, generations fall back to the faceless scene-only model.
        </li>
        <li>
          <strong>You can withdraw consent at any time</strong>, from the app&rsquo;s settings.
          Withdrawal takes effect immediately: the stored photo is deleted, and the next
          generation reverts to the scene-only model.
        </li>
        <li>
          <strong>What we do not do.</strong> We do not use your photo to train models, do not use
          it for facial recognition, identity verification, or biometric matching, do not use it
          to build any face template, and do not share it with anyone beyond the image provider
          named above.
        </li>
      </ul>
      <p className="mt-3">
        Upload only photos of yourself. Because a photograph of a face is sensitive, and treated
        as biometric-adjacent information in some places, we ask for it separately, we ask for it
        only when you use this feature, and we delete it the moment you say so.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">5. Messages that suggest a crisis</h2>
      <p>
        Coaches are not therapists or doctors, and a coaching app is a place where people sometimes
        say hard things. So every message you send is checked, automatically and before a coach
        replies, for signs that you may be in danger: talk of suicide or self&#8209;harm, someone
        hurting you, or a medical emergency.
      </p>
      <p className="mt-3">
        This check is a fixed list of patterns running on our own servers. It is{' '}
        <strong>not</strong> an AI model, your message is not sent anywhere for it, and no human
        reads your messages as part of it. If nothing matches, nothing is recorded and your message
        is handled normally.
      </p>
      <p className="mt-3">If something does match, three things happen:</p>
      <ul className="list-disc pl-6 space-y-2 mt-2">
        <li>
          The coach stops coaching and gives you crisis resources for your region instead. No AI
          model is involved in that reply.
        </li>
        <li>
          We record that it happened, on the conversation. That record holds a category (for
          example &ldquo;suicidal ideation&rdquo; or &ldquo;medical emergency&rdquo;) and which
          patterns matched. <strong>It does not hold your words</strong>, though the message itself
          stays in your conversation history like any other.
        </li>
        <li>
          Your coach will not send you an unprompted check&#8209;in for the next three days. It is a
          pause, not a block, and you can keep messaging normally.
        </li>
      </ul>
      <p className="mt-3">
        Be aware of what this means: a category like that is information about your health, inferred
        rather than something you told us. We do not sell it, share it, or use it for anything other
        than showing you resources and holding back notifications. Nobody at your club, gym or studio
        can see it, and nor can anyone else you train with. It is deleted with your account. The
        check is not perfect: it will sometimes fire on an ordinary message, and it will sometimes
        miss a real one. It is a safety net, not a diagnosis, and it is not a substitute for
        emergency services.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">6. Retention</h2>
      <p>
        We keep your account data for as long as your account exists. Conversations and
        visualisations are kept so your history stays intact, until you delete them or your
        account. A withdrawn reference photo is deleted at the point of withdrawal. Push tokens
        are released when you sign out on that device.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">7. Your choices and rights</h2>
      <ul className="list-disc pl-6 mt-2 space-y-2">
        <li>Turn notifications off, per coach or entirely, in the app&rsquo;s settings.</li>
        <li>Withdraw likeness consent, which also deletes the stored photo.</li>
        <li>
          <strong>Delete your account from inside the app</strong>, under Settings &rsaquo;
          Account &rsaquo; Delete account. This removes your profile, your conversations, your
          goals, your visualisations, your notification tokens and any stored reference photo. It
          takes effect immediately and cannot be undone. Note that it does{' '}
          <strong>not</strong> cancel an Apple subscription, because only Apple can do that &mdash;
          cancel it in your Apple ID subscription settings, or you will continue to be charged.
        </li>
        <li>
          Ask us for a copy of your data, for a correction, or for deletion by hand instead, by
          emailing{' '}
          <a className="text-blue-600 underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
            {LEGAL_CONTACT_EMAIL}
          </a>
          . We act on deletion requests within 30 days.
        </li>
      </ul>
      <p className="mt-3">
        Depending on where you live you may have further rights (for example under the GDPR or the
        CCPA), including to object to processing or to complain to your data protection
        authority. We honour those requests regardless of where you live.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">8. Security</h2>
      <p>
        Data is encrypted in transit, access to it is restricted per account by row-level security
        in the database, and stored files are private and served over signed links. No system is
        perfectly secure, and we will tell you if a breach affects your data.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">9. Children</h2>
      <p>
        The Service is not for children under 13, and we do not knowingly collect their
        information. If you believe a child has given us data, email us and we will delete it.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">10. Changes</h2>
      <p>
        We may update this policy. The date at the top shows the current version, and material
        changes will be surfaced in the app.
      </p>

      <h2 className="text-xl font-semibold mt-6 mb-2">11. Contact</h2>
      <p>
        Privacy questions or requests:{' '}
        <a className="text-blue-600 underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
          {LEGAL_CONTACT_EMAIL}
        </a>
        .
      </p>
    </div>
  );
}
