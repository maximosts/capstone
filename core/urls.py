from django.urls import path
from . import views
from core.api_auth import csrf, me, login_view, logout_view, register_view
from core.views import (
    dashboard_summary, generate_plan, get_intake_logs,
    get_weight_logs, latest_plan, edit_weight_log, edit_intake_log,
    food_search, tracker_entries, tracker_delete, chat, create_food,
    food_admin_list, food_admin_delete, food_admin_bulk_delete,
    chat_history, chat_clear,
    conversation_list, conversation_create, conversation_delete, conversation_rename, conversation_messages,
)

urlpatterns = [
    path("csrf/",               csrf),
    path("auth/me/",            me),
    path("auth/login/",         login_view),
    path("auth/logout/",        logout_view),
    path("auth/register/",      register_view),

    path("profile/",            views.profile_view),
    path("generate-plan/",      views.generate_plan),
    path("latest-plan/",        views.latest_plan),
    path("log-weight/",         views.log_weight),
    path("log-intake/",         views.log_intake),
    path("bayes-debug/",          views.bayes_debug),
    path("recompute-targets/",  views.recompute_targets),
    path("weights/",            get_weight_logs),
    path("weights/<int:log_id>/", edit_weight_log),
    path("intakes/",            get_intake_logs),
    path("intakes/<int:log_id>/", edit_intake_log),
    path("dashboard/",          dashboard_summary),

    # Calorie tracker
    path("foods/search/",           food_search),
    path("tracker/",                tracker_entries),
    path("tracker/<int:entry_id>/", tracker_delete),

    # AI chatbot
    path("chat/",                                    chat),
    path("chat/history/",                            chat_history),
    path("chat/clear/",                              chat_clear),
    path("conversations/",                           conversation_list),
    path("conversations/new/",                       conversation_create),
    path("conversations/<int:convo_id>/",            conversation_delete),
    path("conversations/<int:convo_id>/rename/",     conversation_rename),
    path("conversations/<int:convo_id>/messages/",   conversation_messages),
    path("foods/create/",          create_food),

    # Coaching
    path("coaching/status/",    views.coaching_status),
    path("coaching/subscribe/", views.coaching_subscribe),
    path("coaching/messages/",  views.coaching_messages),
    path("coaching/send/",      views.coaching_send),
    path("coaching/cancel/",    views.coaching_cancel),

    # Coaching admin (staff only)
    path("coaching/admin/",                          views.coaching_admin_inbox),
    path("coaching/admin/<int:convo_id>/messages/",  views.coaching_admin_thread),
    path("coaching/admin/<int:convo_id>/reply/",     views.coaching_admin_reply),

    # Food DB admin
    path("food-db/",               food_admin_list),
    path("food-db/<int:food_id>/",  food_admin_delete),
    path("food-db/bulk-delete/",   food_admin_bulk_delete),
]