export const SAMPLE_CSV = `record_id,type,equipment,description,status,due_date,done_date,remarks
WO-118,Work order,SW pump No.2,Replace mechanical seal; leaking at gland,Completed,,2026-03-12,
PO-552,Spare order,SW pump No.2,Mechanical seal x1,Delivered,,2026-03-20,Delivered Busan
WO-141,Work order,SW pump No.2,Seal leaking again; seal renewed,Completed,,2026-05-02,
PO-610,Spare order,SW pump No.2,Mechanical seal x2,Delivered,,2026-05-15,Delivered Singapore
DR-27,Defect,SW pump No.2,Seal weeping after about 5 hrs running,Open,,,Monitoring
WO-163,Work order,SW pump No.2,Seal leak; seal renewed (3rd time),Completed,,2026-09-09,
WO-171,Work order,SW pump No.2,Planned seal renewal,Planned,2026-10-30,,Seal on board
LOG-0731,Engine log,FO return line cyl 4,Temporary clamp fitted to stop small weep,Noted,,2026-07-31,
ALM-AUG,Alarm summary,Generator 1,Cooling water high temp alarm x42; acknowledged,Noted,,2026-08-31,No action logged
DR-31,Defect,Generator 1,High temp alarm; local gauge 78C normal; alarm reset,Closed,,2026-09-15,
PO-644,Spare order,FO purifier No.1,Bowl seal kit,Ordered,2026-09-28,,Awaiting delivery
DR-33,Defect,FO purifier No.1,Bowl seal leaking; purifier stopped,Open,,,Waiting for PO-644
WO-158,Work order,Lifeboat engine,Weekly running test,Overdue,2026-10-04,,Starter motor weak
WO-170,Work order,Generator 2,8000-hr overhaul,Planned,2026-11-05,,
WO-150,Work order,Main engine,Scavenge port inspection,Completed,,2026-08-20,Light deposits units 3 and 4
WO-166,Work order,Air compressor No.1,Valve overhaul,Completed,,2026-09-21,
WO-172,Work order,Emergency generator,Monthly load test,Planned,2026-10-20,,
WO-160,Work order,Sewage treatment plant,Blower service,Overdue,2026-09-30,,Spares on board
DR-29,Defect,Boiler,Burner flame failure trips at low load,Closed,,2026-08-11,Photocell cleaned
WO-165,Work order,Steering gear,Hydraulic oil sample,Completed,,2026-09-18,Result normal`;

export const SAMPLE_NOTES = `03 Oct 2026, office to ship: The purifier bowl seal kit (PO-644) is delayed. It will now be supplied at Singapore, ETA 28 Oct.
14 Sep 2026, office to ship: Please confirm the lifeboat starter motor condition before the next Port State Control window.`;

export const DEMO_KNOWLEDGE = `SW pump No.2: the real cause is a worn shaft sleeve, not the seal; new seals only last a few weeks. Ravi runs it max 4 hours then switches to pump No.3. Sleeve must be replaced at next dry dock; WO-171 seal renewal is pointless.
FO return line cyl 4 clamp: temporary; check every watch for leaks; a new pipe section was never ordered, it must be ordered.
Generator 1 alarm: false alarm; sensor wire in junction box JB-4 comes loose with heat and vibration; alarm is real only if the local gauge also reads high.
FO purifier No.1: run purifier No.2 as main until the kit arrives in Singapore; No.1 only in emergency.
Lifeboat engine: starter weak because battery charger on the boat deck is faulty; Ravi charges the battery manually from the engine room every Sunday before the test; new charger needed.
Sewage plant blower: overdue because the spare belt on board is the wrong size; correct belt part number is in the maker manual page 34.`;

export const DEFAULT_QUESTIONS = [
  'What should I check on my first watch?',
  'Can I run seawater pump No. 2 all day?',
  'The generator 1 alarm went off. Should I stop it?',
  'Which jobs are overdue?',
];
