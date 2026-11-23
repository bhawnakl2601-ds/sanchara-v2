import { useEffect, useState } from 'react';
import { useApp } from '../app/state';
import { FeatureShell } from '../ui/FeatureShell';
import { Emergency, LostFound } from '../alerts/pages2';
import { get } from '../api/client';
import { useLive } from '../live/LiveProvider';
import { useFetch } from '../alerts/kit';
import { AssistAdmin } from '../alerts/Admin';

type Sub = 'home' | 'lf' | 'emergency' | 'staff';
/** Fourth hub category. Two separate subcategories; clearly a work in progress. */
export function PassengerAssistance() {
  const { assistSub, lateral } = useApp(); const [sub, setSub] = useState<Sub>(assistSub); const { online, user } = useLive();
  const st = useFetch(() => get<any>('/api/assistance/status'), [online]);
  return (
    <FeatureShell kicker="Metro Guide · Passenger assistance" title="Help when you need it." className="sa assist" back={{ label: 'Back to Metro Guide', go: () => lateral('guide') }}>
      <div className="sa-row sa-wrap"><span className="chip chip--p">WORK IN PROGRESS</span>
        <p className="fine sa-grow">{st.data?.message ?? 'This section is a work in progress. Nothing here is monitored in real time, and no emergency requests are sent or dispatched from SANCHARA.'}</p></div>
      <nav className="sa-tabs" role="tablist" aria-label="Passenger assistance sections">
        {([['home', 'Overview'], ['lf', 'Lost & Found'], ['emergency', 'Emergency Contacts'], ...(user?.role === 'admin' ? [['staff', 'Staff queue']] : [])] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k as Sub)}>{l}</button>)}
      </nav>
      <div className="sa-body">
        {sub === 'home' && (
          <div className="sa-two">
            <button className="panel sa-entry" onClick={() => setSub('lf')}><span className="chip chip--p">WORK IN PROGRESS</span><h3>Lost &amp; Found</h3><p className="fine">Report a lost or found item. {st.data?.submissions_enabled ? 'Test submissions are enabled; they are not monitored in real time.' : 'Submissions are switched off in this release; you can browse how it will work.'}</p></button>
            <button className="panel sa-entry" onClick={() => setSub('emergency')}><span className="sa-tag">Information only</span><h3>Emergency Contacts</h3><p className="fine">Call 112 for police, fire or ambulance. BMRCL helpline and email, with their verification status. SANCHARA does not dispatch help.</p></button>
          </div>)}
        {sub === 'lf' && <LostFound />}
        {sub === 'emergency' && <Emergency />}
        {sub === 'staff' && <AssistAdmin />}
      </div>
    </FeatureShell>
  );
}
