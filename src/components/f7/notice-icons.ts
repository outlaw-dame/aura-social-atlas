/** Each notification kind's icon on the phone (Framework7 Icons on iOS, Material Symbols on Android). */
export const noticeIcon: Record<string, { ios: string; md: string }> = {
  favourite: { ios: 'f7:heart_fill', md: 'material:favorite' },
  reblog: { ios: 'f7:arrow_2_circlepath', md: 'material:sync' },
  follow: { ios: 'f7:person_badge_plus_fill', md: 'material:person_add' },
  follow_request: { ios: 'f7:person_badge_plus', md: 'material:person_add_alt' },
  mention: { ios: 'f7:at', md: 'material:alternate_email' },
  reply: { ios: 'f7:arrowshape_turn_up_left_fill', md: 'material:reply' },
  quote: { ios: 'f7:quote_bubble_fill', md: 'material:format_quote' },
  update: { ios: 'f7:square_pencil', md: 'material:edit' },
  quoted_update: { ios: 'f7:square_pencil', md: 'material:edit' },
  status: { ios: 'f7:square_pencil', md: 'material:edit' },
  poll: { ios: 'f7:chart_bar_alt_fill', md: 'material:poll' },
  added_to_collection: { ios: 'f7:square_stack_3d_up_fill', md: 'material:collections_bookmark' },
  collection_update: { ios: 'f7:square_stack_3d_up', md: 'material:collections_bookmark' },
};
