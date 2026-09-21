const aiInvestigatorDemoQuestions = [
  "What caused the click on the unlabeled 'dcsedde' button at 07:43:11.616Z [E1] to trigger a navigation to /configurations/dashboard/249 [E2] rather than a labeled action?",
  "Why did the page transition to /configurations/dashboard/714 last only 1289ms before another transition occurred at 07:43:11.617Z [E2][E3]?",
  "What caused the 'tab-hidden' reason for the /configurations/dashboard/714 page transition at 07:43:13.048Z [E3]?",
  "Why did the session navigate from /configurations/dashboard/714 to /configurations/dashboard/717 at 07:43:17.998Z without an intervening user-click event recorded [E4]?",
  "What triggered the second 'tab-hidden' event on /configurations/dashboard/717 at 07:43:18.855Z after only 858ms on the page [E5]?",
  "What was the intended action behind the 'arrow_back_ios' button click at 07:43:21.316Z [E6], and did it correspond to the subsequent navigation event at 07:43:22.400Z [E8]?",
  "Why did clicking 'Time Wise' at 07:43:22.399Z [E7] coincide almost exactly with the page-transition timestamp of 07:43:22.400Z on /configurations/dashboard/717 [E8]?",
  "What caused the final page transition to /configurations/dashboard/252 to be marked 'tab-hidden' at 07:43:23.272Z after only 872ms [E9]?",
  "Is there a causal link between the rapid sequence of dashboard IDs (249, 714, 717, 252) visited between 07:43:10Z and 07:43:23Z [E2][E3][E4][E5][E8][E9] and the single 'dcsedde' click at the start of the session [E1]?",
  "Given the short session duration of 18 seconds and only two labeled user-clicks ('dcsedde' [E1] and 'arrow_back_ios' [E6], 'Time Wise' [E7]), what additional evidence (e.g., API calls or console logs) is needed to determine whether any backend request failures occurred during these navigations?",
];

export default aiInvestigatorDemoQuestions;
