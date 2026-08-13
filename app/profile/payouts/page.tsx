import { redirect } from 'next/navigation';

export default function PayoutsRedirect() {
  redirect('/profile?tab=payouts');
}
