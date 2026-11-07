export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      atlas_collection_items: {
        Row: {
          acct: string
          actor_uri: string
          avatar_url: string | null
          collection_id: string
          created_at: string
          display_name: string | null
          id: string
          position: number
          profile_url: string | null
          state: string
        }
        Insert: {
          acct: string
          actor_uri: string
          avatar_url?: string | null
          collection_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          position?: number
          profile_url?: string | null
          state?: string
        }
        Update: {
          acct?: string
          actor_uri?: string
          avatar_url?: string | null
          collection_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          position?: number
          profile_url?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "atlas_collection_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "atlas_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      atlas_collections: {
        Row: {
          created_at: string
          description: string | null
          discoverable: boolean
          id: string
          language: string | null
          name: string
          owner_id: string
          sensitive: boolean
          tag_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          discoverable?: boolean
          id?: string
          language?: string | null
          name: string
          owner_id: string
          sensitive?: boolean
          tag_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          discoverable?: boolean
          id?: string
          language?: string | null
          name?: string
          owner_id?: string
          sensitive?: boolean
          tag_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fedizen_connections: {
        Row: {
          access_token: string
          account_handle: string | null
          created_at: string
          scope: string
          user_id: string
        }
        Insert: {
          access_token: string
          account_handle?: string | null
          created_at?: string
          scope: string
          user_id: string
        }
        Update: {
          access_token?: string
          account_handle?: string | null
          created_at?: string
          scope?: string
          user_id?: string
        }
        Relationships: []
      }
      fedizen_oauth_apps: {
        Row: {
          client_id: string
          client_secret: string
          created_at: string
          redirect_uri: string
        }
        Insert: {
          client_id: string
          client_secret: string
          created_at?: string
          redirect_uri: string
        }
        Update: {
          client_id?: string
          client_secret?: string
          created_at?: string
          redirect_uri?: string
        }
        Relationships: []
      }
      fedizen_oauth_states: {
        Row: {
          code_verifier: string
          created_at: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          redirect_uri: string
          state: string
          user_id: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          redirect_uri?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_key: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          featured_hashtags: string[]
          id: string
        }
        Insert: {
          avatar_key?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          featured_hashtags?: string[]
          id: string
        }
        Update: {
          avatar_key?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          featured_hashtags?: string[]
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
